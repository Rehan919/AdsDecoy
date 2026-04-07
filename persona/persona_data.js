(function attachPersonaData(globalScope) {
  const PERSONAS = {
    gardener: [
      "https://www.almanac.com/gardening",
      "https://www.gardeningknowhow.com/garden-by-region",
      "https://www.thespruce.com/gardening-4127766",
      "https://www.bhg.com/gardening/",
      "https://www.gardenersworld.com/plants/"
    ],
    executive: [
      "https://www.bloomberg.com/",
      "https://www.ft.com/markets",
      "https://www.wsj.com/news/business",
      "https://www.reuters.com/business/",
      "https://www.economist.com/business"
    ],
    student: [
      "https://www.khanacademy.org/",
      "https://www.coursera.org/",
      "https://www.edx.org/",
      "https://www.nationalgeographic.com/science/",
      "https://www.scientificamerican.com/"
    ]
  };

  const DEFAULT_PERSONA = "gardener";

  function getPersonaSites(personaName) {
    return PERSONAS[personaName] || PERSONAS[DEFAULT_PERSONA];
  }

  function hasPersona(personaName) {
    return Boolean(PERSONAS[personaName]);
  }

  globalScope.PersonaData = {
    PERSONAS,
    DEFAULT_PERSONA,
    getPersonaSites,
    hasPersona
  };
})(globalThis);
