(function attachDomainMatcher(globalScope) {
  const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
    "ac",
    "co",
    "com",
    "edu",
    "gov",
    "net",
    "org"
  ]);

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

  function getBaseDomain(hostname) {
    if (!hostname) {
      return "";
    }

    const segments = hostname.split(".").filter(Boolean);

    if (segments.length <= 2) {
      return segments.join(".");
    }

    const lastSegment = segments[segments.length - 1];
    const secondLastSegment = segments[segments.length - 2];
    const hasCountryCodeSuffix =
      lastSegment.length === 2 &&
      COMMON_SECOND_LEVEL_SUFFIXES.has(secondLastSegment) &&
      segments.length >= 3;

    return hasCountryCodeSuffix
      ? segments.slice(-3).join(".")
      : segments.slice(-2).join(".");
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

  function isThirdPartyRequest(requestHostname, pageHostname) {
    if (!requestHostname || !pageHostname) {
      return true;
    }

    return getBaseDomain(requestHostname) !== getBaseDomain(pageHostname);
  }

  globalScope.DomainMatcher = {
    extractHostname,
    getDomainVariants,
    getBaseDomain,
    findMatchingTrackerDomain,
    isThirdPartyRequest
  };
})(globalThis);
