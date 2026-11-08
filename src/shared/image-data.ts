export function isEmbeddedRasterImage(url: string): boolean {
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+={0,2}$/i.test(url);
}
