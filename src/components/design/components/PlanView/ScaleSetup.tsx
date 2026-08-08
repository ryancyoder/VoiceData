// ScaleSetup has been replaced by the point matching system.
// Points are matched between the photo and plan views to compute
// a homography transform. See useProjectStore.addMatchedPoint.
export const ScaleSetup = {
  onCanvasTap: (_x: number, _y: number) => {},
  activeStep: 'idle' as string,
};
