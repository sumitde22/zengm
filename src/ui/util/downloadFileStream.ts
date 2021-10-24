import streamSaver from "streamsaver";
import downloadFile from "./downloadFile";

export const HAS_FILE_SYSTEM_ACCESS_API = !!window.showSaveFilePicker;

// Why is this in UI? streamsaver does not work in worker. Otherwise it would be better there.
// If this is ever moved to the worker, becareful about file system access API crashing Chrome 93/94 https://dumbmatter.com/file-system-access-worker-bug/
const downloadFileStream = async (stream: boolean, filename: string) => {
	if (stream) {
		let fileStream: WritableStream;
		if (HAS_FILE_SYSTEM_ACCESS_API) {
			const fileHandle = await window.showSaveFilePicker({
				suggestedName: filename,
				types: [
					{
						description: "JSON Files",
						accept: {
							"application/json": [".json"],
						},
					},
				],
			} as any);

			fileStream = await fileHandle.createWritable();
		} else {
			fileStream = streamSaver.createWriteStream(filename);
		}

		/*const fileStream2 = new WritableStream({
			write(chunk) {
				// console.log(chunk);
			}
		})*/

		return fileStream;
	}

	const contents: Uint8Array[] = [];

	const fileStream = new WritableStream({
		write(chunk) {
			contents.push(chunk);
		},
		close() {
			downloadFile(filename, contents, "application/json");
		},
	});

	return fileStream;
};

export default downloadFileStream;
