
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

        // Create a web worker
        this.worker = new Worker("worker.js")
    }

    async callWorkerMethod(method, args) {
        return new Promise((resolve, reject) => {
            try {
                this.worker.onmessage = (event) => {
                    if (event.data.error) {
                        alert(event.data.error)
                        reject(event.data.error)
                    }
                    resolve(event.data.result);
                }

                this.worker.postMessage({method, args})
            } catch (e) {
                alert("wtf? " + e)
            }
        })
    }

    async downloadAndStoreSegment(segUrl, path) {
        await this.callWorkerMethod("downloadAndStoreSegment", [segUrl, path]);
    }


    async saveInlineInfo(path, inlineData) {
        await this.callWorkerMethod("saveInlineInfo", [path, inlineData]);
    }

    async readInlineFile(path) {
        return this.callWorkerMethod("readInlineFile", [path]);
    }

    async getAsURL(path) {
        return this.callWorkerMethod("getAsURL", [path]);
    }

    async removeEntry(root, name) {
        return this.callWorkerMethod("removeEntry", [this.downloadFolderName]);
    }

    async download(inlineData) {
        const totalSegments = inlineData.segments.length

        let inlineFilePath = [this.downloadFolderName, "data.json"]
        await this.saveInlineInfo(inlineFilePath, inlineData)
        while (this.currentSegment < totalSegments) {
            let newFilePath = [this.downloadFolderName, this.currentSegment + ".ts"]
            let segmentUrl = inlineData.segments[this.currentSegment]
            await this.downloadAndStoreSegment(segmentUrl, newFilePath)
            if (this.onProgress) {
                setTimeout(() => this.onProgress(this.currentSegment, totalSegments), 1)
            }
            this.currentSegment++
            console.info(`downloaded segment ${this.currentSegment} of ${totalSegments}`)
        }
    }

    async restore() {
        const inlineFilePath = [this.downloadFolderName, "data.json"]
        let inlineData = await this.readInlineFile(inlineFilePath)
        let results = []
        for (let segmentIndex = 0; segmentIndex < inlineData.segments.length; segmentIndex++) {
            let filePath = [this.downloadFolderName, segmentIndex + ".ts"]
            let urlString = await this.getAsURL(filePath)
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
        progressSpan.insertBefore(p, progressSpan.firstChild)
    }
    await downloader.download(inlineData)
}

async function removeStream() {
    const downloader = new HlsOPFSDownloader("downloaded_test")
    await downloader.removeEntry()
}

// testHls().then()
