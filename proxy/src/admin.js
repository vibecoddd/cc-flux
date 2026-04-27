const config = require('./config');
const metrics = require('./metrics');

function sendConfigError(reply, error) {
  const statusCode = error.statusCode || 500;
  return reply.code(statusCode).send({
    error: {
      code: error.code || 'admin_error',
      message: error.message
    }
  });
}

function readPresentedAdminToken(request) {
  const authorization = request.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const header = request.headers['x-cc-flux-admin-token'];
  return Array.isArray(header) ? header[0] : header;
}

function isAdminAuthorized(request) {
  const requiredToken = config.getAdminToken();
  if (!requiredToken) return true;
  return readPresentedAdminToken(request) === requiredToken;
}

function requireAdminAuth(request, reply, done) {
  if (isAdminAuthorized(request)) {
    done();
    return;
  }

  reply.code(401).send({
    error: {
      code: 'admin_auth_required',
      message: 'Admin token is required.'
    }
  });
}

function registerAdminRoutes(fastify) {
  fastify.get('/admin/profiles', { preHandler: requireAdminAuth }, async () => {
    return {
      profiles: config.listProfiles(),
      meta: config.getMeta()
    };
  });

  fastify.get('/admin/current', { preHandler: requireAdminAuth }, async () => {
    return {
      config: config.getPublic(),
      meta: config.getMeta()
    };
  });

  fastify.get('/admin/health', { preHandler: requireAdminAuth }, async () => {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      profileCount: config.listProfiles().length,
      config: config.getPublic(),
      meta: config.getMeta()
    };
  });

  fastify.get('/admin/metrics', { preHandler: requireAdminAuth }, async () => {
    return {
      metrics: metrics.snapshot()
    };
  });

  fastify.get('/admin/compression', { preHandler: requireAdminAuth }, async () => {
    return {
      compression: config.getCompression()
    };
  });

  fastify.post('/admin/compression', { preHandler: requireAdminAuth }, async (request, reply) => {
    try {
      const compression = config.updateCompression(request.body || {});
      metrics.increment('compressionUpdates');
      return {
        compression
      };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  fastify.post('/admin/switch', { preHandler: requireAdminAuth }, async (request, reply) => {
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
      metrics.increment('profileSwitches');
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
module.exports.requireAdminAuth = requireAdminAuth;
