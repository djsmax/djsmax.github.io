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
                let result = await readInlineFile(...args);
                postMessage({result});
                break;
            case "getAsURL":
                let result2 = await getAsURL(...args);
                postMessage({result: result2});
                break;
            case "removeEntry":
                let result3 = await removeEntry(...args);
                postMessage({result: result3});
                break;
        }
    } catch (e) {
        postMessage({error: e});
    }
}

async function downloadAndStoreSegment(segUrl, path) {
    let fileHandle = await resolvePath(path)
    if (fileHandle != null) {
        return
    }
    fileHandle = await resolvePath(path, true)
    let response = await fetch(segUrl)
    if (!response.ok) {
        throw "can't fetch segment"
    }
    const wtr = await fileHandle.createSyncAccessHandle();
    try {
        wtr.write(await response.arrayBuffer());
    } finally {
        await wtr.close();
    }
}

async function saveInlineInfo(path, inlineData) {
    const fileHandle = await resolvePath(path, true)
    const wtr = await fileHandle.createSyncAccessHandle()
    try {
        wtr.write(new TextEncoder().encode(JSON.stringify(inlineData)))
    } finally {
        await wtr.close()
    }
}

async function readInlineFile(path) {
    let fileHandle = await resolvePath(path)
    let file = await fileHandle.getFile()
    return new Promise((res, rej) => {
        let reader = new FileReader();
        reader.readAsText(file)

        reader.onload = function () {
            res(JSON.parse(reader.result));
        };

        reader.onerror = function () {
            rej("inline is unreadable");
        };
    });
}

async function getRoot() {
    // Open the "root" of the website's (origin's) private filesystem:
    let storageRoot = null
    try {
        storageRoot = await navigator.storage.getDirectory()
    } catch (err) {
        console.error(err)
        alert("Couldn't open OPFS. See browser console.\n\n" + err)
        return
    }

    return storageRoot
}

async function resolvePath(pathList, create) {
    let currentDirectory = await getRoot();

    for (let i = 0; i < pathList.length - 1; i++) {
        const directoryName = pathList[i]

        try {
            currentDirectory = await currentDirectory.getDirectoryHandle(directoryName, {create})
        } catch (error) {
            return null
        }
    }

    // Get or create the target file
    const targetFileName = pathList[pathList.length - 1];
    try {
        return await currentDirectory.getFileHandle(targetFileName, {create});
    } catch (_) {
        return null
    }
}

async function getAsURL(path) {
    let fileHandle = await resolvePath(path)
    if (fileHandle == null) {
        return null
    }
    let file = await fileHandle.getFile()
    return URL.createObjectURL(file)
}

async function removeEntry(path) {
    let root = await getRoot()
    await root.removeEntry(path, {recursive:true})
    return true
}