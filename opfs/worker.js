onmessage = async function (event) {
    const { method, args } = event.data;
    try {
        switch (method) {
            case "downloadAndStoreSegment":
                await downloadAndStoreSegment(...args);
                postMessage({result: true});
                break;
            case "saveInlineInfo":
                await saveInlineInfo(...args);
                postMessage({result: true});
                break;
            case "readInlineFile":
                const result = await readInlineFile(...args);
                postMessage({result});
                break;
        }
    } catch (e) {
        postMessage({error: e});
    }
}

async function downloadAndStoreSegment(segUrl, fileHandle) {
    let response = await fetch(segUrl);
    if (!response.ok) {
        throw "can't fetch segment";
    }
    const wtr = await fileHandle.createSyncAccessHandle();
    try {
        wtr.write(await response.arrayBuffer());
    } finally {
        await wtr.close();
    }
}

async function saveInlineInfo(fileHandle, inlineData) {
    const wtr = await fileHandle.createSyncAccessHandle();
    try {
        wtr.write(new TextEncoder().encode(JSON.stringify(inlineData)));
    } finally {
        await wtr.close();
    }
}

async function readInlineFile(file) {
    return new Promise((res, rej) => {
        let reader = new FileReader();
        reader.readAsText(file);

        reader.onload = function () {
            res(JSON.parse(reader.result));
        };

        reader.onerror = function () {
            rej("inline is unreadable");
        };
    });
}
