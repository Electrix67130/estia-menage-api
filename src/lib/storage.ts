import path from 'path';
import fs from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import env from '@/config/env';

/**
 * Abstraction de stockage de fichiers. Deux backends selon `STORAGE_MODE` :
 * - `local` : disque du serveur (`uploads/`), servi via les routes /files.
 * - `s3`    : Scaleway Object Storage (compatible S3), servi via redirection
 *             vers une URL présignée.
 *
 * Le contrat HTTP (POST /upload, GET /files/...) reste identique dans les deux
 * modes : les clients ne voient jamais le backend.
 */

export const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

export interface UploadResult {
  size: number;
}

export interface Storage {
  readonly mode: 'local' | 's3';
  /** Sauvegarde un flux sous `storedName`, renvoie la taille écrite. */
  upload(storedName: string, stream: Readable, contentType: string): Promise<UploadResult>;
  /** Vrai si l'objet existe. */
  exists(storedName: string): Promise<boolean>;
  /** Lit l'objet complet en mémoire (usage : générer une miniature). */
  read(storedName: string): Promise<Buffer>;
  /** URL présignée de téléchargement (mode s3 uniquement). */
  presignedUrl(storedName: string, expiresInSeconds?: number): Promise<string>;
}

/** Transform qui compte les octets qui le traversent, sans les altérer. */
function byteCounter(onDone: (size: number) => void): Transform {
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      cb(null, chunk);
    },
    flush(cb) {
      onDone(size);
      cb();
    },
  });
}

class LocalStorage implements Storage {
  readonly mode = 'local' as const;

  constructor() {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  }

  async upload(storedName: string, stream: Readable): Promise<UploadResult> {
    const filePath = path.join(UPLOAD_DIR, storedName);
    await pipeline(stream, fs.createWriteStream(filePath));
    return { size: fs.statSync(filePath).size };
  }

  async exists(storedName: string): Promise<boolean> {
    return fs.existsSync(path.join(UPLOAD_DIR, storedName));
  }

  async read(storedName: string): Promise<Buffer> {
    return fs.promises.readFile(path.join(UPLOAD_DIR, storedName));
  }

  async presignedUrl(): Promise<string> {
    throw new Error('presignedUrl indisponible en mode de stockage local');
  }
}

class S3Storage implements Storage {
  readonly mode = 's3' as const;

  // Imports dynamiques : le SDK AWS n'est chargé que si STORAGE_MODE=s3,
  // pour que le dev/local et les tests ne dépendent pas de sa configuration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clientPromise: Promise<any> | null = null;

  private async sdk() {
    const [{ S3Client }, libStorage, presigner, clientS3] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/lib-storage'),
      import('@aws-sdk/s3-request-presigner'),
      import('@aws-sdk/client-s3'),
    ]);
    if (!this.clientPromise) {
      this.clientPromise = Promise.resolve(
        new S3Client({
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY,
            secretAccessKey: env.S3_SECRET_KEY,
          },
        }),
      );
    }
    const client = await this.clientPromise;
    return { client, Upload: libStorage.Upload, getSignedUrl: presigner.getSignedUrl, clientS3 };
  }

  async upload(storedName: string, stream: Readable, contentType: string): Promise<UploadResult> {
    const { client, Upload } = await this.sdk();
    let size = 0;
    const counter = byteCounter((s) => {
      size = s;
    });
    const upload = new Upload({
      client,
      params: {
        Bucket: env.S3_BUCKET,
        Key: storedName,
        Body: stream.pipe(counter),
        ContentType: contentType,
      },
    });
    await upload.done();
    return { size };
  }

  async exists(storedName: string): Promise<boolean> {
    const { client, clientS3 } = await this.sdk();
    try {
      await client.send(new clientS3.HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: storedName }));
      return true;
    } catch {
      return false;
    }
  }

  async read(storedName: string): Promise<Buffer> {
    const { client, clientS3 } = await this.sdk();
    const res = await client.send(
      new clientS3.GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storedName }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async presignedUrl(storedName: string, expiresInSeconds = 300): Promise<string> {
    const { client, getSignedUrl, clientS3 } = await this.sdk();
    const command = new clientS3.GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storedName });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }
}

const storage: Storage = env.STORAGE_MODE === 's3' ? new S3Storage() : new LocalStorage();

export default storage;
