import { output } from "@assetpipe/vite/client";

const files = output.glob("/*.txt");
document.body.dataset.files = JSON.stringify(files);
