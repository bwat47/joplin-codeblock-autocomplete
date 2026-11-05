import { isRenderedCodeContainer } from './codeContainer';

/**
 * Matches the opening tag of Joplin's hidden source element, for example
 * `<pre class="joplin-source" hidden data-joplin-language="ts" ...>`.
 */
const SOURCE_TAG_PATTERN = /<pre\b[^>]*\bclass=(['"])[^'"]*\bjoplin-source\b[^'"]*\1[^>]*>/;
/**
 * Matches Joplin's opening fence attribute and captures its value, which is the fence, the language
 * and an encoded newline (for example three backticks followed by `ts&#10;`).
 */
const SOURCE_OPEN_PATTERN = /\bdata-joplin-source-open="([^"]*)"/;
/** Captures the fence at the start of the opening fence attribute's value. */
const FENCE_PATTERN = /^`{3,}/;
const ENCODED_NEWLINE = '&#10;';
/** Matches Joplin's language attribute, for example `data-joplin-language="ts"`. */
const LANGUAGE_PATTERN = /\bdata-joplin-language="[^"]*"/;

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Keeps options written after the language in the Rich Text editor's copy of the fence.
 *
 * Joplin's code renderer fills the hidden `joplin-source` element's attributes from the language
 * alone, and the Rich Text editors rebuild the Markdown from those attributes, so a fence with the
 * info string `ts ln start=5` would be saved, copied and edited with just `ts`. This writes the
 * whole info string back into them:
 *
 * - `data-joplin-source-open` is what saving, copying and the mobile editor's source dialog use.
 * - `data-joplin-language` fills the desktop editor's code dialog, which rebuilds the fence from it.
 *
 * Info strings without options are left alone, as are info strings containing a backtick (which can
 * only come from a tilde fence and cannot follow the backtick fence Joplin writes), and any output
 * whose source element does not have the expected shape.
 */
export function preserveFenceInfo(renderedHtml: string, rawInfo: string): string {
    const info = rawInfo.trim();
    if (!/\s/.test(info) || info.includes('`') || !isRenderedCodeContainer(renderedHtml)) {
        return renderedHtml;
    }

    const escapedInfo = escapeAttribute(info);

    return renderedHtml.replace(SOURCE_TAG_PATTERN, (sourceTag) => {
        const openValue = SOURCE_OPEN_PATTERN.exec(sourceTag)?.[1];
        const fence = openValue?.endsWith(ENCODED_NEWLINE) ? FENCE_PATTERN.exec(openValue)?.[0] : undefined;
        if (fence === undefined) {
            return sourceTag;
        }

        // Replacer functions keep `$` sequences in the info string from being read as patterns.
        return sourceTag
            .replace(SOURCE_OPEN_PATTERN, () => `data-joplin-source-open="${fence}${escapedInfo}${ENCODED_NEWLINE}"`)
            .replace(LANGUAGE_PATTERN, () => `data-joplin-language="${escapedInfo}"`);
    });
}
