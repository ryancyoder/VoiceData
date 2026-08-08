interface PointPair {
  photoX: number;
  photoY: number;
  planX: number;
  planY: number;
}

/**
 * Compute a 3x3 homography matrix from matched point pairs using
 * Direct Linear Transform (DLT).
 */
export function computeHomography(points: PointPair[]): number[] | null {
  if (points.length < 4) {
    // Fall back to affine for 3 points, similarity for 2
    if (points.length >= 2) return computeAffineApprox(points);
    return null;
  }

  // Build the DLT matrix (2 rows per point pair)
  const A: number[][] = [];

  for (const p of points) {
    const { photoX: x, photoY: y, planX: xp, planY: yp } = p;
    A.push([-x, -y, -1, 0, 0, 0, x * xp, y * xp, xp]);
    A.push([0, 0, 0, -x, -y, -1, x * yp, y * yp, yp]);
  }

  // Solve Ah = 0 using SVD (simplified: use the last column of V)
  const h = solveHomogeneous(A, 9);
  if (!h) return null;

  return h;
}

/**
 * Apply a homography to a point.
 * H is a flat 9-element array.
 */
export function applyHomography(
  H: number[],
  x: number,
  y: number
): { x: number; y: number } {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-10) return { x, y }; // degenerate
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

/**
 * Compute the inverse of a 3x3 homography matrix.
 */
export function invertHomography(H: number[]): number[] | null {
  // 3x3 matrix inverse
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;

  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * Approximate affine/similarity transform for 2-3 point pairs.
 * Returns a homography-format 9-element array (with h6=h7=0, h8=1).
 */
function computeAffineApprox(points: PointPair[]): number[] | null {
  if (points.length === 2) {
    // Similarity transform: translation + uniform scale + rotation
    const [p1, p2] = points;
    const dx1 = p2.photoX - p1.photoX;
    const dy1 = p2.photoY - p1.photoY;
    const dx2 = p2.planX - p1.planX;
    const dy2 = p2.planY - p1.planY;

    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (len1 < 1e-6) return null;

    const scale = len2 / len1;
    const angle = Math.atan2(dy2, dx2) - Math.atan2(dy1, dx1);
    const cosA = Math.cos(angle) * scale;
    const sinA = Math.sin(angle) * scale;

    const tx = p1.planX - (cosA * p1.photoX - sinA * p1.photoY);
    const ty = p1.planY - (sinA * p1.photoX + cosA * p1.photoY);

    return [cosA, -sinA, tx, sinA, cosA, ty, 0, 0, 1];
  }

  if (points.length === 3) {
    // Full affine from 3 points
    const [p1, p2, p3] = points;
    const A = [
      [p1.photoX, p1.photoY, 1, 0, 0, 0],
      [0, 0, 0, p1.photoX, p1.photoY, 1],
      [p2.photoX, p2.photoY, 1, 0, 0, 0],
      [0, 0, 0, p2.photoX, p2.photoY, 1],
      [p3.photoX, p3.photoY, 1, 0, 0, 0],
      [0, 0, 0, p3.photoX, p3.photoY, 1],
    ];
    const b = [p1.planX, p1.planY, p2.planX, p2.planY, p3.planX, p3.planY];

    const params = solveLinear6(A, b);
    if (!params) return null;

    return [params[0], params[1], params[2], params[3], params[4], params[5], 0, 0, 1];
  }

  return null;
}

/**
 * Solve a homogeneous system Ah = 0 for the null vector.
 * Uses Jacobi-like approach: compute A^T A, then find the eigenvector
 * for the smallest eigenvalue via power iteration on the inverse.
 */
function solveHomogeneous(A: number[][], cols: number): number[] | null {
  // Compute A^T A (cols x cols symmetric matrix)
  const ATA: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  for (const row of A) {
    for (let i = 0; i < cols; i++) {
      for (let j = i; j < cols; j++) {
        ATA[i][j] += row[i] * row[j];
        if (i !== j) ATA[j][i] = ATA[i][j];
      }
    }
  }

  // Inverse power iteration to find the eigenvector for the smallest eigenvalue
  // Start with a random vector
  let v = new Array(cols).fill(0).map(() => Math.random() - 0.5);
  normalize(v);

  // We need to solve (A^T A) x = v iteratively
  // Use Gauss-Seidel or just direct solve since it's 9x9
  for (let iter = 0; iter < 50; iter++) {
    const next = solveLinearNxN(ATA, v);
    if (!next) return v; // matrix is singular, current v is already null
    normalize(next);
    v = next;
  }

  return v;
}

function normalize(v: number[]) {
  let len = 0;
  for (const x of v) len += x * x;
  len = Math.sqrt(len);
  if (len < 1e-15) return;
  for (let i = 0; i < v.length; i++) v[i] /= len;
}

/**
 * Solve Ax = b for a small NxN system using Gaussian elimination with partial pivoting.
 */
function solveLinearNxN(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  // Build augmented matrix
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return null;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back-substitute
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }

  return x;
}

/**
 * Solve a 6x6 linear system (for affine transform).
 */
function solveLinear6(A: number[][], b: number[]): number[] | null {
  return solveLinearNxN(A, b);
}
