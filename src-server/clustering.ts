import { normalizeVector, dotProduct } from './masking';

export interface KMeansResult {
  centroids: Float32Array[];
  normCentroids: Float32Array[];
  labels: number[];
  actualNClusters: number;
}

export function runKMeans(
  vectors: Float32Array[],
  maxClusters: number = 8,
  maxIters: number = 20
): KMeansResult {
  const n = vectors.length;
  if (n === 0) {
    return { centroids: [], normCentroids: [], labels: [], actualNClusters: 0 };
  }

  const dim = vectors[0].length;
  const k = Math.min(n, Math.max(1, maxClusters));

  if (k === 1) {
    const centroid = new Float32Array(dim);
    for (const v of vectors) {
      for (let d = 0; d < dim; d++) centroid[d] += v[d];
    }
    for (let d = 0; d < dim; d++) centroid[d] /= n;
    const norm = normalizeVector(centroid);
    return {
      centroids: [centroid],
      normCentroids: [norm],
      labels: new Array(n).fill(0),
      actualNClusters: 1,
    };
  }

  // Initialize centroids with k-means++ style or spread samples
  const centroids: Float32Array[] = [];
  const chosenIndices = new Set<number>();
  centroids.push(new Float32Array(vectors[0]));
  chosenIndices.add(0);

  for (let c = 1; c < k; c++) {
    let bestIdx = -1;
    let maxDist = -1;
    for (let i = 0; i < n; i++) {
      if (chosenIndices.has(i)) continue;
      let minDist = Infinity;
      for (const centroid of centroids) {
        let distSq = 0;
        for (let d = 0; d < dim; d++) {
          const diff = vectors[i][d] - centroid[d];
          distSq += diff * diff;
        }
        if (distSq < minDist) minDist = distSq;
      }
      if (minDist > maxDist) {
        maxDist = minDist;
        bestIdx = i;
      }
    }
    const idx = bestIdx >= 0 ? bestIdx : Math.floor(Math.random() * n);
    chosenIndices.add(idx);
    centroids.push(new Float32Array(vectors[idx]));
  }

  const labels = new Array(n).fill(0);

  // Lloyd's algorithm iterations
  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;

    // Assignment step
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let closestCluster = 0;
      for (let c = 0; c < k; c++) {
        let distSq = 0;
        for (let d = 0; d < dim; d++) {
          const diff = vectors[i][d] - centroids[c][d];
          distSq += diff * diff;
        }
        if (distSq < minDist) {
          minDist = distSq;
          closestCluster = c;
        }
      }
      if (labels[i] !== closestCluster) {
        labels[i] = closestCluster;
        changed = true;
      }
    }

    if (!changed) break;

    // Update step
    const counts = new Array(k).fill(0);
    const newCentroids = Array.from({ length: k }, () => new Float32Array(dim));

    for (let i = 0; i < n; i++) {
      const c = labels[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) {
        newCentroids[c][d] += vectors[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dim; d++) {
          newCentroids[c][d] /= counts[c];
        }
        centroids[c] = newCentroids[c];
      }
    }
  }

  const normCentroids = centroids.map((c) => normalizeVector(c));

  return {
    centroids,
    normCentroids,
    labels,
    actualNClusters: k,
  };
}
