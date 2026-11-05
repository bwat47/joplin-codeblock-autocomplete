import { parseFenceInfo, resolveLineNumbering } from './fenceInfo';

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
        expect(parseFenceInfo('ln')).toEqual({ language: 'ln', lineNumbers: null, lineNumberStart: null, title: null });
    });

    it('does not read options from inside quoted values of other options', () => {
        expect(parseFenceInfo('ts title="ln=false start=4" ln')).toEqual({
            language: 'ts',
            lineNumbers: true,
            lineNumberStart: null,
            title: 'ln=false start=4',
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
