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

class HlsProcessing {

    EARLY_HEADERS = [
        "#EXTM3U",
        "#EXT-X-MEDIA-SEQUENCE",
        "#EXT-X-TARGETDURATION"
    ]

    constructor() {
        this.basePath = "https://bitdash-a.akamaihd.net/content/sintel/hls/video"
    }

    toInline(manifestStr) {
        let lines = manifestStr.split("\n")
        let stage = 'early'
        let preVals = []

        let segmentLength = -1
        let lastLineWasSegmentLengthSpecifier = false
        let segments = []

        for (let line of lines) {
            if (line === '') {
                continue
            }
            if (stage === 'early' &&
                this.anyStartsWith(this.EARLY_HEADERS, line)) {
                // anything in the beginning should be kept as-is
                preVals.push(line)
                continue
            }
            if (stage === 'early' && line.startsWith("#EXTINF")) {
                // change the stage
                segmentLength = this.parseSegmentLength(line)
                lastLineWasSegmentLengthSpecifier = true
                stage = 'stream'
            } else if (stage === 'stream' && line.startsWith("#EXTINF")) {
                // segment length should be the same, check that
                let newSegmentLength = this.parseSegmentLength(line)
                if (newSegmentLength !== segmentLength) {
                    throw "segment length has been changed throughout, wtf"
                }
                lastLineWasSegmentLengthSpecifier = true
            }
            // actual url
            else if (stage === 'stream' &&
                ((line.startsWith("/") || line.startsWith("http"))
                    || lastLineWasSegmentLengthSpecifier)) {
                // figure out absolute url
                let absoluteUrl
                if (lastLineWasSegmentLengthSpecifier) {
                    // stupid fucking specifier without the leading slash
                    absoluteUrl = this.basePath + "/" + line
                } else if (line.startsWith("/")) {
                    // relative path
                    absoluteUrl = this.basePath + line
                } else if (line.startsWith("http")) {
                    // absolute path
                    absoluteUrl = line
                } else {
                    throw "unknown URL specified"
                }

                lastLineWasSegmentLengthSpecifier = false
                segments.push(absoluteUrl)
            } else if (stage === 'stream' && line === '#EXT-X-ENDLIST') {
                // according to the spec, that's the end
                // would be lovely to know what could be packed after this tag
                break
            } else {
                throw "unknown command or stage: " + line
            }
        }
        return {
            preVals, segmentLength, segments
        }
    }

    toManifest(inlineData) {
        let manifest = []
        if (!inlineData.preVals || inlineData.preVals.length === 0 || inlineData.preVals[0] !== "#EXTM3U") {
            manifest.push("#EXTM3U")
        }
        if (inlineData.preVals && inlineData.preVals.length > 0) {
            manifest = [...manifest, ...inlineData.preVals]
        }
        for (let segUrl of inlineData.segments) {
            manifest.push("#EXTINF:" + inlineData.segmentLength + ",")
            manifest.push(segUrl)
        }
        // we play nice
        manifest.push("#EXT-X-ENDLIST")
        return manifest.join("\n")
    }


    anyStartsWith(list, src) {
        for (let val of list) {
            if (src.startsWith(val)) {
                return true
            }
        }
        return false
    }

    parseSegmentLength(line) {
        return parseInt(line.trim().replaceAll(",", '').split(":")[1])
    }
}

class HlsOPFSDownloader {

    constructor(downloadFolderName) {
        this.downloadFolderName = downloadFolderName
        // downloader, for progress restore
        this.currentSegment = 0
        this.onProgress = null
    }

    async downloadAndStoreSegment(segUrl, fileHandle) {
        fetch(segUrl).then(async res => {
            if (!res.ok) {
                throw "can't fetch segment"
            }
            const wtr = await fileHandle.createWritable()
            try {
                // Then write the Blob object directly:
                await wtr.write(await res.blob())
            } finally {
                // And safely close the file stream writer:
                await wtr.close()
            }
        })
    }

    async saveInlineInfo(fileHandle, inlineData) {
        const wtr = await fileHandle.createWritable()
        try {
            await wtr.write(JSON.stringify(inlineData))
        } finally {
            await wtr.close()
        }
    }

    async download(inlineData) {
        const totalSegments = inlineData.segments.length

        let storageRoot = await getRoot()
        const subdir = await storageRoot.getDirectoryHandle(this.downloadFolderName,
            {"create": true})
        let inlineFileHandle = await subdir.getFileHandle("data.json", {create: true})
        await this.saveInlineInfo(inlineFileHandle, inlineData)
        while (this.currentSegment < totalSegments) {
            const newFileHandle = await subdir.getFileHandle(this.currentSegment + ".ts",
                {"create": true})
            let segmentUrl = inlineData.segments[this.currentSegment]
            await this.downloadAndStoreSegment(segmentUrl, newFileHandle)
            if (this.onProgress) {
                setTimeout(() => this.onProgress(this.currentSegment, totalSegments), 1)
            }
            this.currentSegment++
            console.info(`downloaded segment ${this.currentSegment} of ${totalSegments}`)
        }
    }

    async restore() {
        let storageRoot = await getRoot()
        const subdir = await storageRoot.getDirectoryHandle(this.downloadFolderName)
        let inlineFileHandle = await subdir.getFileHandle("data.json", {create: true})
        let inlineFile = await inlineFileHandle.getFile()
        let inlineData = await this.readInlineFile(inlineFile)
        let results = []
        for (let segmentIndex = 0; segmentIndex < inlineData.segments.length; segmentIndex++) {
            let fileHandle = await subdir.getFileHandle(segmentIndex + ".ts")
            let file = await fileHandle.getFile()
            let urlString = URL.createObjectURL(file)
            results.push(urlString)
        }
        let restoredData = await this.restoreInlineData(inlineData, results)
        return {results, restoredData}
    }

    async restoreInlineData(inlineData, segmentList) {
        // spoof "online" segment URLs with "offline" blobs
        inlineData.segments = segmentList
        return inlineData
    }

    async readInlineFile(file) {
        return new Promise((res, rej) => {
            let reader = new FileReader()
            reader.readAsText(file)

            reader.onload = function () {
                res(JSON.parse(reader.result))
            }

            reader.onerror = function () {
                rej("inline is unreadable")
            }
        })
    }

}

async function testHls() {
    // downloading: fetch the manifest, convert HLS manifest to an internal format
    // pass inline data to the downloader, the rest is managed internally

    // const hlsToDownload = "https://bitdash-a.akamaihd.net/content/sintel/hls/video/10000kbit.m3u8"
    // const hlsRawData = await (await fetch(hlsToDownload)).text()
    // const processor = new HlsProcessing()
    // // process manifest into an own custom format "inline"
    // let inlineData = processor.toInline(hlsRawData.replaceAll("\r", ""))
    // console.info(inlineData)

    // const downloader = new HlsOPFSDownloader("downloaded_test")
    // await downloader.download(inlineData)



    // offline watching: pass existing folder name without any other data
    // the rest is, again, managed internally

    const offlineLoader = new HlsOPFSDownloader("downloaded_test")
    let restoreResults = await offlineLoader.restore()
    console.info(restoreResults)

    // reconstruct the manifest using processor
    const processor = new HlsProcessing()
    let fullyOfflineManifest = processor.toManifest(restoreResults.restoredData)
    console.info(fullyOfflineManifest)



    // debugger
}

async function createStream() {
    const offlineLoader = new HlsOPFSDownloader("downloaded_test")
    let restoreResults = await offlineLoader.restore()
    console.info(restoreResults)

    // reconstruct the manifest using processor
    const processor = new HlsProcessing()
    let fullyOfflineManifest = processor.toManifest(restoreResults.restoredData)
    console.info(fullyOfflineManifest)
    const fullyOfflineManifestBlob = new Blob([fullyOfflineManifest], {
        type: 'application/vnd.apple.mpegurl'
    })

    if (Hls.isSupported()) {
        const video = document.getElementById('video-1')
        const hls = new Hls({debug: true})
        hls.loadSource(URL.createObjectURL(fullyOfflineManifestBlob))
        hls.attachMedia(video)
        video.play()
    }
}

async function downloadStream() {
    const hlsToDownload = "https://bitdash-a.akamaihd.net/content/sintel/hls/video/1500kbit.m3u8"
    const hlsRawData = await (await fetch(hlsToDownload)).text()
    const processor = new HlsProcessing()
    // process manifest into an own custom format "inline"
    let inlineData = processor.toInline(hlsRawData.replaceAll("\r", ""))
    console.info(inlineData)

    const progressSpan = document.getElementById("progress")

    const downloader = new HlsOPFSDownloader("downloaded_test")
    downloader.onProgress = (current, total) => {
        let p = document.createElement("p")
        p.innerText = "dl - " + current + " - " + total
        progressSpan.appendChild(p)
    }
    await downloader.download(inlineData)
}


// testHls().then()