/** Regiões usadas no ranking regional (escolhidas no cadastro). */
export const REGIONS = [
  { id: "norte", name: "Norte" },
  { id: "nordeste", name: "Nordeste" },
  { id: "centro-oeste", name: "Centro-Oeste" },
  { id: "sudeste", name: "Sudeste" },
  { id: "sul", name: "Sul" },
  { id: "exterior", name: "Fora do Brasil" },
];
export const regionName = id => REGIONS.find(r => r.id === id)?.name ?? "Sem região";
