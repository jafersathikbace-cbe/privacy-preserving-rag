export interface MaskTransform {
  perm: number[];
  signs: number[];
}

export function generateTransform(dim: number): MaskTransform {
  const perm = Array.from({ length: dim }, (_, i) => i);
  // Fisher-Yates shuffle
  for (let i = dim - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = perm[i];
    perm[i] = perm[j];
    perm[j] = temp;
  }

  const signs = Array.from({ length: dim }, () => (Math.random() < 0.5 ? -1 : 1));
  return { perm, signs };
}

export function applyTransform(
  vector: Float32Array | number[],
  perm: number[],
  signs: number[]
): Float32Array {
  const dim = perm.length;
  const result = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    result[i] = signs[i] * vector[perm[i]];
  }
  return result;
}

export function normalizeVector(vector: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq) || 1e-8;
  const result = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] / norm;
  }
  return result;
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
