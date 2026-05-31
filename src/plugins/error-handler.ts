import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { FastifyInstance, FastifyError } from 'fastify';

async function errorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | ZodError | Error, request, reply) => {
    // Zod validation errors → 400
    if (error instanceof ZodError) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Validation Error',
        message: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
      });
    }

    // Fastify/sensible errors (notFound, etc.)
    if ('statusCode' in error && typeof (error as FastifyError).statusCode === 'number') {
      const fastifyError = error as FastifyError;
      return reply.code(fastifyError.statusCode!).send({
        statusCode: fastifyError.statusCode,
        error: fastifyError.name,
        message: fastifyError.message,
      });
    }

    // Unknown errors → 500. On log dans pino ET dans error_log (Sentry maison).
    request.log.error(error);
    // Fire-and-forget : on ne bloque pas la réponse sur le insert DB.
    void fastify
      .db('error_log')
      .insert({
        level: 'error',
        message: error.message || 'Unknown error',
        stack: error.stack ?? null,
        route: request.url,
        method: request.method,
        user_id: (request.user as { sub?: string } | undefined)?.sub ?? null,
        status_code: 500,
        request_id: request.id,
      })
      .catch((dbErr) => fastify.log.error({ err: dbErr }, 'Failed to write error_log'));

    return reply.code(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
  });
}

export default fp(errorHandler, { name: 'error-handler' });
