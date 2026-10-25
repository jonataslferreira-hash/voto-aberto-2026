export function parseScope(scopeRaw) {
  const scope = scopeRaw || 'brasil';
  const [kind, detail] = scope.split(':');

  if (kind === 'exterior-geral') {
    return { kind, uf: 'zz', city: null, countryCode: null };
  }
  if (kind === 'exterior-pais') {
    return { kind, uf: 'zz', city: detail || null, countryCode: detail || null };
  }
  if (kind === 'exterior-cidade') {
    return { kind, uf: 'zz', city: detail || null, countryCode: null };
  }
  if (kind === 'estado') {
    return { kind, uf: (detail || 'br').toLowerCase(), city: null, countryCode: null };
  }
  if (kind === 'municipio') {
    const [uf, city] = (detail || '').split('/');
    return { kind, uf: (uf || 'br').toLowerCase(), city: city || null, countryCode: null };
  }
  return { kind: 'brasil', uf: 'br', city: null, countryCode: null };
}
