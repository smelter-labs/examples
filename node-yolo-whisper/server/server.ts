import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

export type HttpServerOptions = {
  port: number;
  onCategory: (value: string) => void;
};

const categoryBody = z.object({
  value: z.string().min(1),
});

export async function startHttpServer(opts: HttpServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-allow-methods', 'POST,OPTIONS');
  });

  app.options('/*', async (_req, reply) => reply.code(204).send());

  app.post('/api/category', {
    schema: { body: categoryBody },
    handler: (req, reply) => {
      const { value } = req.body;
      console.log(`[http] category → ${value}`);
      opts.onCategory(value);
      reply.code(204).send();
    },
  });

  await app.listen({ port: opts.port, host: '0.0.0.0' });
  console.log(`HTTP listening on :${opts.port}`);
  return app;
}
