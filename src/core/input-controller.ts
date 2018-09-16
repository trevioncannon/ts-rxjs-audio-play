import * as Rx from "rxjs/Rx";
import Knob from "../ui/knob";

/**
 * Utility class to control an incoming signal from various places (MIDI and
 * key board as of today). Some fiddling with RXjs, mostly.
 */
export default class InputController implements IDisposable {

    private knobs: Knob[];
    private activeKnob: Knob | undefined;
    private activeKnobIndex: number | undefined;

    private subscriptions: Rx.Subscription[];

    constructor() {

        this.knobs = [];
        this.subscriptions = [];

        this.subscriptions.push(this.connectMidiController());
        this.subscriptions.push(this.numPadControl());
        this.subscriptions.push(this.arrowsSelectControl());
    }

    registerKnob = (knob: Knob) => {
        this.knobs.push(knob);
        this.selectKnob(knob);
        console.log(`registered knob ${knob.id}`);
    }

    selectKnob = (knob: Knob) => {

        if (this.activeKnob) {
            this.activeKnob.markSelection(false);
        }

        this.activeKnob = knob;
        for (let i: number = 0; i < this.knobs.length; i++) {
            if (this.knobs[i].id === knob.id) {
                this.activeKnobIndex = i;
            }
        }

        knob.markSelection(true);
    }

    private selectKnobByIndex = (i: number) => {

        if (this.activeKnob) {
            this.activeKnob.markSelection(false);
        }

        this.activeKnobIndex = i;
        this.activeKnob = this.knobs[i];
        this.activeKnob.markSelection(true);
    }

    dispose(): void {
        this.subscriptions.forEach(s => s.unsubscribe());
    }

    /**
     * Connect to a MIDI controller (just pick the first found)
     */
    private connectMidiController = function (this: InputController): Rx.Subscription {

        let midiInputs$: Rx.Observable<number> = Rx.Observable.fromPromise(navigator.requestMIDIAccess())
            .flatMap((access: WebMidi.MIDIAccess) => {

                if (access.inputs.size === 0) {
                    throw "No MIDI input detected.";
                }

                let input: WebMidi.MIDIInput = access.inputs.values().next().value!;
                console.log(`Listening to input '${input.name}'...`);

                return Rx.Observable.fromEvent(input, "midimessage").map((event) => {
                    let midiEvent: WebMidi.MIDIMessageEvent = event as WebMidi.MIDIMessageEvent;
                    return Math.round(midiEvent.data[2]);
                });
            })
            .distinctUntilChanged();

        return midiInputs$.subscribe(
            value => {
                if (this.activeKnob) {
                    let ratio: number = value / 127;
                    let normalizedValue: number = Math.round(
                        this.activeKnob.minValue + ratio * (this.activeKnob.maxValue - this.activeKnob.minValue));
                    this.activeKnob.next(normalizedValue);
                    console.log(`Pushing a value to ${this.activeKnob.id}`);
                }
            },
            error => console.error(error)
        );
    };

    /**
     * Control input from keyboard (will produce a value shortly after no additional number has been typed)
     */
    private numPadControl = function (this: InputController): Rx.Subscription {

        const KEY0: number = 48;
        const KEY9: number = 57;
        const KEYNUM0: number = 96;
        const KEYNUM9: number = 105;

        let input$: Rx.Observable<KeyboardEvent> = Rx.Observable.fromEvent<KeyboardEvent>(document, "keydown");
        let debounceBreak$: Rx.Observable<KeyboardEvent> = input$.debounceTime(350);
        let stream$: Rx.Observable<number> = input$
            .map((event) => {
                let code: number = event.keyCode;
                if (code >= KEYNUM0 && code <= KEYNUM9) {
                    return code - KEYNUM0;
                } else if (code >= KEY0 && code <= KEY9) {
                    return code - KEY0;
                }
                return -1;
            })
            .filter((digit) => digit >= 0)
            .buffer(debounceBreak$)
            .filter((digits) => digits.length > 0)
            .map((digits: number[]) => {
                let value: number = 0;
                digits.reverse().forEach((digit: number, index: number) => {
                    value += Math.pow(10, index) * digit;
                });
                return value;
            });

        return stream$.subscribe(
            state => {
                if (this.activeKnob) {
                    let normalizedValue: number = Math.min(this.activeKnob.maxValue, Math.max(this.activeKnob.minValue, state));
                    this.activeKnob.next(normalizedValue);
                }
            },
            error => console.error(error));
    };

    /**
     * Control input from keyboard (will select next or previous knob based on registered order)
     */
    private arrowsSelectControl = function (this: InputController): Rx.Subscription {

        const KEY_LEFT: number = 37;
        const KEY_RIGHT: number = 39;

        const arrayIndex: (i: number, length: number) => number = (x, n) => (x % n + n) % n;

        return Rx.Observable.fromEvent<KeyboardEvent>(document, "keydown")
            .map((event) => {
                let code: number = event.keyCode;
                if (code === KEY_LEFT) {
                    return -1;
                } else if (code === KEY_RIGHT) {
                    return 1;
                }
                return 0;
            })
            .filter(x => x !== 0)
            .subscribe(
                x => {
                    let test: number = this.activeKnobIndex !== undefined
                        ? this.activeKnobIndex + x
                        : 0;
                    this.selectKnobByIndex(arrayIndex(test, this.knobs.length));
                },
                error => console.error(error));
    };
}