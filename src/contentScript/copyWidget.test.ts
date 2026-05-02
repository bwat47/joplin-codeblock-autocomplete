import { markdown } from '@codemirror/lang-markdown';
import { createEditorHarness } from '../testUtils/editorHarness';
import { copyWidgetTheme, createCopyWidgetPlugin } from './copyWidget';
import { applyPluginSettings, createSettingsExtension } from './pluginSettings';
import type { PluginContext } from './types';

function createPluginContext(): jest.Mocked<PluginContext> {
    return {
        postMessage: jest.fn().mockResolvedValue(undefined),
    };
}

function getCopyWidgetButton(): HTMLButtonElement {
    const button = document.querySelector('.cm-codeblock-copy-widget');
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Expected copy widget button to be rendered.');
    }

    return button;
}

function getCopyWidgetButtons(): HTMLButtonElement[] {
    const buttons = Array.from(document.querySelectorAll('.cm-codeblock-copy-widget')).filter(
        (button): button is HTMLButtonElement => button instanceof HTMLButtonElement
    );

    if (buttons.length === 0) {
        throw new Error('Expected copy widget buttons to be rendered.');
    }

    return buttons;
}

function dispatchPointerDown(button: HTMLButtonElement, pointerType: string): void {
    const event = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(event, 'pointerType', {
        value: pointerType,
    });
    button.dispatchEvent(event);
}

function dispatchPointerUp(button: HTMLButtonElement, pointerType: string): void {
    const event = new Event('pointerup', { bubbles: true });
    Object.defineProperty(event, 'pointerType', {
        value: pointerType,
    });
    button.dispatchEvent(event);
}

describe('createCopyWidgetPlugin', () => {
    it('copies quoted fenced code without block quote markers', () => {
        const context = createPluginContext();
        const harness = createEditorHarness('> ```txt\n> first line\n> second line\n> ```\n|', {
            extensions: [markdown(), createSettingsExtension(), copyWidgetTheme, createCopyWidgetPlugin(context)],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: true,
                languages: [],
            });

            getCopyWidgetButton().click();

            expect(context.postMessage).toHaveBeenCalledWith({
                command: 'copyCodeBlock',
                text: 'first line\nsecond line',
            });
        } finally {
            harness.destroy();
        }
    });

    it('copies plain fenced code content unchanged', () => {
        const context = createPluginContext();
        const harness = createEditorHarness('```txt\nplain text\n```\n|', {
            extensions: [markdown(), createSettingsExtension(), copyWidgetTheme, createCopyWidgetPlugin(context)],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: true,
                languages: [],
            });

            const initialCursor = harness.getCursor();
            const button = getCopyWidgetButton();

            dispatchPointerDown(button, 'mouse');
            button.click();

            expect(context.postMessage).toHaveBeenCalledWith({
                command: 'copyCodeBlock',
                text: 'plain text',
            });

            expect(harness.getCursor()).toBe(initialCursor);
            expect(document.querySelector('.cm-codeblock-copy-widget')).not.toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('moves the cursor before copying for touch activations', () => {
        const context = createPluginContext();
        const harness = createEditorHarness('```txt\nplain text\n```\n|', {
            extensions: [markdown(), createSettingsExtension(), copyWidgetTheme, createCopyWidgetPlugin(context)],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: true,
                languages: [],
            });

            const button = getCopyWidgetButton();

            dispatchPointerDown(button, 'touch');
            dispatchPointerUp(button, 'touch');
            button.click();

            expect(context.postMessage).toHaveBeenCalledWith({
                command: 'copyCodeBlock',
                text: 'plain text',
            });

            expect(harness.getCursor()).toBe(harness.view.state.doc.line(2).from);
        } finally {
            harness.destroy();
        }
    });

    it('does not carry touch state into a later mouse click', () => {
        const context = createPluginContext();
        const harness = createEditorHarness('```txt\nplain text\n```\n|', {
            extensions: [markdown(), createSettingsExtension(), copyWidgetTheme, createCopyWidgetPlugin(context)],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: true,
                languages: [],
            });

            const initialCursor = harness.getCursor();
            const button = getCopyWidgetButton();

            dispatchPointerDown(button, 'touch');
            dispatchPointerUp(button, 'touch');
            dispatchPointerDown(button, 'mouse');
            button.click();

            expect(context.postMessage).toHaveBeenCalledWith({
                command: 'copyCodeBlock',
                text: 'plain text',
            });

            expect(harness.getCursor()).toBe(initialCursor);
        } finally {
            harness.destroy();
        }
    });

    it('moves the cursor for successive touch taps on different widgets', () => {
        const context = createPluginContext();
        const harness = createEditorHarness('```txt\nfirst\n```\n\n```js\nsecond\n```\n|', {
            extensions: [markdown(), createSettingsExtension(), copyWidgetTheme, createCopyWidgetPlugin(context)],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: true,
                languages: [],
            });

            const [firstButton] = getCopyWidgetButtons();

            dispatchPointerDown(firstButton, 'touch');
            dispatchPointerUp(firstButton, 'touch');
            firstButton.click();

            expect(context.postMessage).toHaveBeenNthCalledWith(1, {
                command: 'copyCodeBlock',
                text: 'first',
            });
            expect(harness.getCursor()).toBe(harness.view.state.doc.line(2).from);

            const [, updatedSecondButton] = getCopyWidgetButtons();

            dispatchPointerDown(updatedSecondButton, 'touch');
            dispatchPointerUp(updatedSecondButton, 'touch');
            updatedSecondButton.click();

            expect(context.postMessage).toHaveBeenNthCalledWith(2, {
                command: 'copyCodeBlock',
                text: 'second',
            });
            expect(harness.getCursor()).toBe(harness.view.state.doc.line(6).from);
        } finally {
            harness.destroy();
        }
    });
});
