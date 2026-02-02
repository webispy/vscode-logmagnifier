/**
 * A lenient JSON parser that attempts to parse invalid or incomplete JSON strings.
 * It uses a Recursive Descent approach to recover from common errors like:
 * - Missing commas between properties or array items
 * - Missing quotes around keys or values (limited support)
 * - Incomplete structures (missing closing braces/brackets)
 */
export interface ParsedNode {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'undefined';
    value?: any;
    children?: ParsedProperty[];
    items?: ParsedNode[];
    isError?: boolean;
}

export interface ParsedProperty {
    key: string;
    value: ParsedNode;
    isKeyError?: boolean;
}

export class LenientJsonParser {
    private index = 0;
    private text = '';

    constructor() { }

    public static toParsedNode(data: any): ParsedNode {
        if (data === null) { return { type: 'null', value: null }; }
        if (data === undefined) { return { type: 'undefined' }; }

        if (Array.isArray(data)) {
            const items = data.map(item => this.toParsedNode(item));
            return { type: 'array', items };
        }

        if (typeof data === 'object') {
            const children: ParsedProperty[] = Object.keys(data).map(key => ({
                key,
                value: this.toParsedNode(data[key])
            }));
            return { type: 'object', children };
        }

        if (typeof data === 'string') { return { type: 'string', value: data }; }
        if (typeof data === 'number') { return { type: 'number', value: data }; }
        if (typeof data === 'boolean') { return { type: 'boolean', value: data }; }

        return { type: 'string', value: String(data) };
    }

    public parse(text: string): ParsedNode {
        this.text = text;
        this.index = 0;
        this.skipWhitespace();

        if (this.index >= this.text.length) {
            return { type: 'undefined' };
        }

        try {
            return this.parseValue();
        } catch (e) {
            return { type: 'string', value: text, isError: true }; // Fallback
        }
    }

    private parseValue(): ParsedNode {
        this.skipWhitespace();
        if (this.index >= this.text.length) {
            return { type: 'undefined' };
        }

        const char = this.text[this.index];

        if (char === '{') {
            return this.parseObject();
        } else if (char === '[') {
            return this.parseArray();
        } else if (char === '"' || char === "'") {
            return { type: 'string', value: this.parseString() };
        } else if (char === 't' && this.match('true')) {
            return { type: 'boolean', value: true };
        } else if (char === 'f' && this.match('false')) {
            return { type: 'boolean', value: false };
        } else if (char === 'n' && this.match('null')) {
            return { type: 'null', value: null };
        } else if (char === '-' || (char >= '0' && char <= '9') || char === '.') {
            return { type: 'number', value: this.parseNumber() };
        } else {
            // Unquoted string -> likely error or lenient key
            const val = this.parseUnquotedString();
            return { type: 'string', value: val, isError: true };
        }
    }

    private parseObject(): ParsedNode {
        const children: ParsedProperty[] = [];
        this.index++; // consume '{'

        while (this.index < this.text.length) {
            this.skipWhitespace();
            if (this.peek() === '}') {
                this.index++;
                return { type: 'object', children };
            }

            // Expect Key
            let key = this.parseString();
            let isKeyError = false;

            if (key === undefined) {
                key = this.parseUnquotedString();
                // Unquoted key is invalid strict JSON, but maybe not "Error" in lenient?
                // User wants "Invalid JSON" tags marked. Unquoted key is definitely invalid.
                if (key) { isKeyError = true; }
            }

            if (!key) {
                if (this.peek() === '}') {
                    this.index++;
                    return { type: 'object', children };
                }
                this.index++;
                continue;
            }

            this.skipWhitespace();
            if (this.peek() === ':') {
                this.index++;
            } else {
                // Missing colon is error
                isKeyError = true;
            }

            // Expect Value
            const value = this.parseValue();
            children.push({ key, value, isKeyError });

            this.skipWhitespace();
            if (this.peek() === ',') {
                this.index++;
            } else if (this.peek() === '}') {
                this.index++;
                return { type: 'object', children };
            } else {
                // Missing comma -> likely error
                // We don't mark the *previous* item error, but the parser flow is broken.
                // We'll proceed.
            }
        }
        return { type: 'object', children, isError: true }; // Unclosed object
    }

    private parseArray(): ParsedNode {
        const items: ParsedNode[] = [];
        this.index++; // consume '['

        while (this.index < this.text.length) {
            this.skipWhitespace();
            if (this.peek() === ']') {
                this.index++;
                return { type: 'array', items };
            }

            const value = this.parseValue();
            items.push(value);

            this.skipWhitespace();
            if (this.peek() === ',') {
                this.index++;
            } else if (this.peek() === ']') {
                this.index++;
                return { type: 'array', items };
            }
            // Missing comma handled by loop
        }
        return { type: 'array', items, isError: true }; // Unclosed array
    }

    private parseString(): string | undefined {
        this.skipWhitespace();
        const quoteType = this.peek();
        if (quoteType !== '"' && quoteType !== "'") {
            return undefined;
        }
        this.index++;

        let result = '';
        let escaped = false;

        while (this.index < this.text.length) {
            const char = this.text[this.index++];
            if (escaped) {
                result += char;
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quoteType) {
                return result;
            } else {
                result += char;
            }
        }
        return result; // Unclosed string
    }

    private parseUnquotedString(): string | undefined {
        this.skipWhitespace();
        let result = '';
        while (this.index < this.text.length) {
            const char = this.text[this.index];
            if ([':', ',', '{', '}', '[', ']', ' ', '\n', '\r', '\t', '"', "'"].includes(char)) {
                break;
            }
            result += char;
            this.index++;
        }
        return result.length > 0 ? result : undefined;
    }

    private parseNumber(): number {
        let start = this.index;
        while (this.index < this.text.length) {
            const char = this.text[this.index];
            if (/[0-9eE\.\+\-]/.test(char)) {
                this.index++;
            } else {
                break;
            }
        }
        const numStr = this.text.substring(start, this.index);
        const num = Number(numStr);
        return isNaN(num) ? 0 : num;
    }

    private skipWhitespace() {
        while (this.index < this.text.length && /\s/.test(this.text[this.index])) {
            this.index++;
        }
    }

    private peek(): string {
        return this.index < this.text.length ? this.text[this.index] : '';
    }

    private match(str: string): boolean {
        if (this.text.substring(this.index, this.index + str.length) === str) {
            this.index += str.length;
            return true;
        }
        return false;
    }
}
