const createFastify = require('fastify');
const config = require('./config');
const registerAdminRoutes = require('./admin');
const messageHandler = require('./handlers/message');

function buildServer(options = {}) {
  const fastify = createFastify({ logger: options.logger !== undefined ? options.logger : true });

  fastify.get('/', async () => {
    const cfg = config.get();
    return {
      status: 'CC-Flux Proxy is running',
      current_config: config.getPublic(),
      port: cfg.port
    };
  });

  registerAdminRoutes(fastify);

  fastify.post('/config', async (request, reply) => {
    const body = request.body;
    if (!body) return reply.code(400).send({ error: 'Missing body' });

    config.update({
      targetProvider: body.provider,
      targetBaseUrl: body.baseUrl,
      targetApiKey: body.apiKey,
      targetModel: body.model,
      retryEnabled: body.retryEnabled
    });

    return { status: 'updated', config: config.getPublic() };
  });

  fastify.post('/v1/messages', messageHandler);

  return fastify;
}

const start = async () => {
  const fastify = buildServer();

  try {
    const cfg = config.get();
    
    if (cfg.socketPath) {
      // Listen on Unix Socket / Named Pipe
      // Windows Named Pipe: \\.\pipe\pipeName
      // Linux/Mac Socket: /tmp/socketName
      // Fastify supports path property in listen
      await fastify.listen({ path: cfg.socketPath });
      console.log(`CC-Flux Proxy listening on IPC path: ${cfg.socketPath}`);
    } else {
      // Listen on TCP
      await fastify.listen({ port: cfg.port, host: '0.0.0.0' });
      console.log(`CC-Flux Proxy listening on ${fastify.server.address().port}`);
    }
    
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

module.exports = { buildServer, start };
