(function attachDomainMatcher(globalScope) {
  function extractHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function getDomainVariants(hostname) {
    if (!hostname) {
      return [];
    }

    const segments = hostname.split(".").filter(Boolean);
    const variants = [];

    for (let index = 0; index < segments.length - 1; index += 1) {
      variants.push(segments.slice(index).join("."));
    }

    return variants;
  }

  function findMatchingTrackerDomain(hostname, trackerDomains) {
    const domainSet = trackerDomains instanceof Set ? trackerDomains : new Set(trackerDomains || []);

    if (!hostname || domainSet.size === 0) {
      return null;
    }

    for (const variant of getDomainVariants(hostname)) {
      if (domainSet.has(variant)) {
        return variant;
      }
    }

    return null;
  }

  globalScope.DomainMatcher = {
    extractHostname,
    getDomainVariants,
    findMatchingTrackerDomain
  };
})(globalThis);
