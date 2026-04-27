function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseCompressionCommand(args) {
  const commandArgs = args[0] === 'compression' ? args.slice(1) : args;
  const action = commandArgs[0] || 'show';

  if (action === 'show') {
    return { method: 'GET', pathname: '/admin/compression', body: undefined };
  }
  if (action === 'on') {
    return { method: 'POST', pathname: '/admin/compression', body: { enabled: true } };
  }
  if (action === 'off') {
    return { method: 'POST', pathname: '/admin/compression', body: { enabled: false } };
  }
  if (action !== 'set') {
    throw new Error('Usage: cc-flux compression [on|off|set --max-messages <n> --keep-recent <n>]');
  }

  const body = {};
  for (let index = 1; index < commandArgs.length; index += 2) {
    const flag = commandArgs[index];
    const value = commandArgs[index + 1];
    if (value === undefined) {
      throw new Error(`${flag} requires a value.`);
    }
    if (flag === '--max-messages') {
      body.maxMessages = parsePositiveInteger(value, flag);
    } else if (flag === '--keep-recent') {
      body.keepRecent = parsePositiveInteger(value, flag);
    } else {
      throw new Error(`Unknown compression option: ${flag}`);
    }
  }

  if (Object.keys(body).length === 0) {
    throw new Error('compression set requires --max-messages or --keep-recent.');
  }

  return { method: 'POST', pathname: '/admin/compression', body };
}

function formatCompressionStatus(compression) {
  return [
    `Compression: ${compression.enabled ? 'enabled' : 'disabled'}`,
    `Max messages: ${compression.maxMessages}`,
    `Keep recent: ${compression.keepRecent}`
  ].join('\n');
}

module.exports = {
  formatCompressionStatus,
  parseCompressionCommand
};
