const fastify = require('fastify')({ logger: true });
const config = require('./config');
const messageHandler = require('./handlers/message');

fastify.get('/', async (request, reply) => {
  const cfg = config.get();
  return { 
    status: 'CC-Flux Proxy is running',
    current_config: {
      provider: cfg.targetProvider,
      model: cfg.targetModel,
      baseUrl: cfg.targetBaseUrl,
      retryEnabled: cfg.retryEnabled,
      socketPath: cfg.socketPath
    }
  };
});

// Admin API: Update Configuration
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

  return { status: 'updated', config: config.get() };
});

// The main route Claude Code uses
fastify.post('/v1/messages', messageHandler);

const start = async () => {
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

module.exports = { start };
