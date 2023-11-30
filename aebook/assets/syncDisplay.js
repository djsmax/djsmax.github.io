const DATA = {
    'en' : ["sound/demo_cut.mp3", "json/hp.b1.c4wwc.json"],
    'ru': ["sound/demo_ru.mp3", "json/hp.ru.ch7.json"],
    'de': ["sound/hp.de.b1.ch6.mp3", "json/hp.de.b1.ch6.json"],
}

function highlight(segmentId, doIt) {
    let $item = $('span[data-id="' + segmentId + '"]')

    if ($item.length === 0) {
        return
    }
    if (doIt) {
        $item.addClass('highlighted')
    } else {
        $item.removeClass('highlighted')
    }
}

class MarkingMan {
    
    constructor() {
        this.$audio = $("#audio")
        this.$text = $("#text")
        this.$select = $("select")
        this.intervalId = null
        this.previousSegmentId = null
        this.src = null

        this.setup()
    }

    setup() {
        this.$audio.on('pause', () => {
            if (this.intervalId != null) {
                clearInterval(this.intervalId)
                this.intervalId = null
            }
        })
        this.$audio.on('seeked', () => {
            this.checkStuff()
        })
        this.$audio.on('play', () => {
            this.checkStuff()
            this.intervalId = setInterval(() => {this.checkStuff()}, 300)
        })

        this.$select.on('input', async () => {
            let id = $('select').find('option:selected').attr('id')
            let selected = DATA[id]
            await this.load(selected[0], selected[1])
        })
    }
    
    async load(soundSrc, markingsSrc) {
        this.$audio[0].src = soundSrc
        this.src = this.enumerateJson(await (await fetch(markingsSrc)).json())

        clearInterval(this.intervalId)
        this.intervalId = null
        this.previousSegmentId = null

        this.$text.html("")

        for (let segment of this.src.segments) {
            for (let word of segment.words) {
                let item = this.makeTextItem(word)
                this.$text.append(item)
            }
        }
    }


    makeTextItem(segment) {
        let id = segment.id
        let $item = $("<span>")
        $item.attr('class', "word")
        $item.attr('data-id', id)
        $item.text(segment.word)
        $item.on('click', () => {
            this.navigateTo(segment.id)
        })

        return $item
    }

    enumerateJson(json) {
        let i = 0
        for (let segment of json.segments) {
            for (let word of segment.words) {
                word.id = i
                i++
            }
        }
        return json
    }


    checkStuff() {
        // go thru the list of segments, find the one currently active
        let currentTime = this.$audio[0].currentTime

        let currSegment = null
        for (let segment of this.src.segments) {
            for (let word of segment.words)
                if (currentTime > word.start && currentTime < word.end) {
                    currSegment = word
                    // console.info("got segment: " + currSegment)
                    break
                }
        }
        if (currSegment == null) {
            return
        }
        // mark it
        if (this.previousSegmentId != null) {
            highlight(this.previousSegmentId, false)
        }
        highlight(currSegment.id, true)
        this.previousSegmentId = currSegment.id
    }


    navigateTo(segmentId) {
        let currSegment = null
        for (let segment of this.src.segments) {
            for (let word of segment.words)
                if (word.id === segmentId) {
                    currSegment = word
                    break
                }
        }
        if (currSegment == null) {
            alert("RIP: no segment of id " + segmentId)
        }

        this.$audio[0].currentTime = currSegment.start
        this.$audio[0].play()
    }

}

$(window).on('load', async () => {
   let markingMan = new MarkingMan()

    await markingMan.load("sound/demo_cut.mp3", "json/hp.b1.c4wwc.json")


})
