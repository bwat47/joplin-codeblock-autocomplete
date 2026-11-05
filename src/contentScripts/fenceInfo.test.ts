import { isLineHighlighted, parseFenceInfo, resolveLineNumbering } from './fenceInfo';

describe('parseFenceInfo', () => {
    it.each([
        ['', ''],
        ['ts', 'ts'],
        ['  ts  ', 'ts'],
        ['ts ln start=3', 'ts'],
        ['c++\tln', 'c++'],
    ])('reads the language from %j', (info, language) => {
        expect(parseFenceInfo(info).language).toBe(language);
    });

    it.each([
        ['ts', null],
        ['ts ln', true],
        ['ts ln=true', true],
        ['ts ln=false', false],
        ['ts ln="false"', false],
        ['ts ln=maybe', null],
        ['ts ln ln=false', false],
        ['ts line', null],
    ])('reads the line-number option from %j', (info, lineNumbers) => {
        expect(parseFenceInfo(info).lineNumbers).toBe(lineNumbers);
    });

    it.each([
        ['ts', null],
        ['ts start=10', 10],
        ['ts start=0', 0],
        ["ts start='7'", 7],
        ['ts start=-1', null],
        ['ts start=1.5', null],
        ['ts start=abc', null],
        ['ts start=', null],
        ['ts start', null],
        ['ts start=1234567890', null],
    ])('reads the start option from %j', (info, lineNumberStart) => {
        expect(parseFenceInfo(info).lineNumberStart).toBe(lineNumberStart);
    });

    it('does not treat the language as an option', () => {
        expect(parseFenceInfo('ln')).toEqual({
            language: 'ln',
            lineNumbers: null,
            lineNumberStart: null,
            title: null,
            highlightedLines: [],
        });
    });

    it('does not read options from inside quoted values of other options', () => {
        expect(parseFenceInfo('ts title="ln=false start=4" ln')).toEqual({
            language: 'ts',
            lineNumbers: true,
            lineNumberStart: null,
            title: 'ln=false start=4',
            highlightedLines: [],
        });
    });

    it.each([
        ['py', null],
        ['py title=math.py', 'math.py'],
        ['py title="utils/math.py"', 'utils/math.py'],
        ['py title="my file.py" ln', 'my file.py'],
        ['py title=\'say "hi".py\'', 'say "hi".py'],
        ['py title=""', null],
        ['py title', null],
        ['py title="unclosed quote', '"unclosed'],
    ])('reads the title option from %j', (info, title) => {
        expect(parseFenceInfo(info).title).toBe(title);
    });
});

describe('highlighted lines', () => {
    it.each([
        ['ts', []],
        ['ts hl=3', [{ from: 3, to: 3 }]],
        [
            'ts hl=10,13-14',
            [
                { from: 10, to: 10 },
                { from: 13, to: 14 },
            ],
        ],
        [
            'ts hl="2, 4-5"',
            [
                { from: 2, to: 2 },
                { from: 4, to: 5 },
            ],
        ],
        ['ts hl=7-5', [{ from: 5, to: 7 }]],
        [
            'ts hl=a,2,-3,4-,1.5,6',
            [
                { from: 2, to: 2 },
                { from: 6, to: 6 },
            ],
        ],
        ['ts hl=', []],
        ['ts hl', []],
    ])('reads the hl option from %j', (info, highlightedLines) => {
        expect(parseFenceInfo(info).highlightedLines).toEqual(highlightedLines);
    });

    it('checks lines against every range', () => {
        const info = parseFenceInfo('ts hl=10,13-14');

        expect([9, 10, 11, 12, 13, 14, 15].map((line) => isLineHighlighted(info, line))).toEqual([
            false,
            true,
            false,
            false,
            true,
            true,
            false,
        ]);
    });
});

describe('resolveLineNumbering', () => {
    it.each([
        ['ts', false, { enabled: false, start: 1 }],
        ['ts', true, { enabled: true, start: 1 }],
        ['ts ln', false, { enabled: true, start: 1 }],
        ['ts ln=false', true, { enabled: false, start: 1 }],
        ['ts start=5', false, { enabled: true, start: 5 }],
        ['ts start=5 ln=false', true, { enabled: false, start: 5 }],
    ])('resolves %j with the default %s', (info, enabledByDefault, expected) => {
        expect(resolveLineNumbering(parseFenceInfo(info), enabledByDefault)).toEqual(expected);
    });
});
