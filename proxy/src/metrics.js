const startedAt = new Date();

const counters = {
  messageRequests: 0,
  conversionErrors: 0,
  upstreamErrors: 0,
  profileSwitches: 0,
  compressionUpdates: 0,
  compressionApplied: 0
};

function increment(name, amount = 1) {
  if (!Object.prototype.hasOwnProperty.call(counters, name)) {
    counters[name] = 0;
  }
  counters[name] += amount;
}

function snapshot() {
  return {
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    ...counters
  };
}

function _resetForTests() {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}

module.exports = {
  increment,
  snapshot,
  _resetForTests
};
