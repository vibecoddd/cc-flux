const config = require('./config');

function sendConfigError(reply, error) {
  const statusCode = error.statusCode || 500;
  return reply.code(statusCode).send({
    error: {
      code: error.code || 'admin_error',
      message: error.message
    }
  });
}

function registerAdminRoutes(fastify) {
  fastify.get('/admin/profiles', async () => {
    return {
      profiles: config.listProfiles(),
      meta: config.getMeta()
    };
  });

  fastify.get('/admin/current', async () => {
    return {
      config: config.getPublic(),
      meta: config.getMeta()
    };
  });

  fastify.get('/admin/compression', async () => {
    return {
      compression: config.getCompression()
    };
  });

  fastify.post('/admin/compression', async (request, reply) => {
    try {
      return {
        compression: config.updateCompression(request.body || {})
      };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  fastify.post('/admin/switch', async (request, reply) => {
    const body = request.body || {};
    if (!body.id || typeof body.id !== 'string') {
      return reply.code(400).send({
        error: {
          code: 'missing_profile_id',
          message: 'Request body must include string field id.'
        }
      });
    }

    try {
      const result = config.switchProfile(body.id);
      return {
        status: 'switched',
        ...result
      };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });
}

module.exports = registerAdminRoutes;
