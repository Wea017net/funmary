// pdfjs-dist は worker のモジュールの型を配っていない。使うのは、pdfjs に渡す WorkerMessageHandler だけ
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
	export const WorkerMessageHandler: unknown;
}
