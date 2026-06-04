import sharp from 'sharp';
import { Transform } from 'stream';

/**
 * Optimisation des images à l'upload. Pour une image, renvoie un flux de
 * transformation sharp à intercaler entre le fichier reçu et le stockage :
 * - auto-orientation selon l'EXIF puis suppression des métadonnées (taille + vie privée) ;
 * - redimensionnement pour tenir dans MAX_DIMENSION (sans agrandir) ;
 * - ré-encodage compressé dans le même format (jpeg/png/webp), sinon format inchangé.
 *
 * Renvoie `null` si le mimetype n'est pas une image → le fichier passe alors
 * tel quel (aucune optimisation appliquée).
 */

const MAX_DIMENSION = 2000; // px, côté le plus long
const QUALITY = 80;

export function optimizeImageStream(mimetype: string): Transform | null {
  if (!mimetype.startsWith('image/')) {
    return null;
  }

  // failOn:'none' → tolérant aux fichiers légèrement corrompus plutôt que de
  // faire échouer tout l'upload.
  const pipeline = sharp({ failOn: 'none' })
    .rotate() // applique l'orientation EXIF puis la retire
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });

  // Ré-encodage selon le format source. Pour tout autre format (gif, svg…),
  // on laisse sharp ré-émettre le format d'origine sans options spécifiques.
  switch (mimetype) {
    case 'image/jpeg':
    case 'image/jpg':
      return pipeline.jpeg({ quality: QUALITY, mozjpeg: true }) as unknown as Transform;
    case 'image/png':
      return pipeline.png({ compressionLevel: 9 }) as unknown as Transform;
    case 'image/webp':
      return pipeline.webp({ quality: QUALITY }) as unknown as Transform;
    default:
      return pipeline as unknown as Transform;
  }
}
