/** esbuild bundles .css imports as text so they can be injected into a shadow root. */
declare module '*.css' {
  const contents: string;
  export default contents;
}
