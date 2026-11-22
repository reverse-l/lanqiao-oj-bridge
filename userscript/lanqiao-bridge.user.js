// ==UserScript==
// @name         Lanqiao OJ Bridge
// @namespace    https://github.com/epsilon-local/lanqiao-oj-bridge
// @version      0.6.0
// @author       reverse-l
// @license      MIT
// @homepageURL  https://github.com/reverse-l/lanqiao-oj-bridge
// @supportURL   https://github.com/reverse-l/lanqiao-oj-bridge/issues
// @downloadURL  https://raw.githubusercontent.com/reverse-l/lanqiao-oj-bridge/main/userscript/lanqiao-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/reverse-l/lanqiao-oj-bridge/main/userscript/lanqiao-bridge.user.js
// @description  蓝桥题面导入 VSCode、CPH 样例、官方在线调试与提交
// @match        https://www.lanqiao.cn/problems/*/learning/*
// @match        https://lanqiao.cn/problems/*/learning/*
// @match        https://www.lanqiao.cn/courses/*/learning/*
// @match        https://lanqiao.cn/courses/*/learning/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==
"use strict";
(() => {
  // node_modules/turndown/lib/turndown.browser.es.js
  function extend(destination) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) destination[key] = source[key];
      }
    }
    return destination;
  }
  function repeat(character, count) {
    return Array(count + 1).join(character);
  }
  function trimLeadingNewlines(string) {
    return string.replace(/^\n*/, "");
  }
  function trimTrailingNewlines(string) {
    var indexEnd = string.length;
    while (indexEnd > 0 && string[indexEnd - 1] === "\n") indexEnd--;
    return string.substring(0, indexEnd);
  }
  function trimNewlines(string) {
    return trimTrailingNewlines(trimLeadingNewlines(string));
  }
  var blockElements = ["ADDRESS", "ARTICLE", "ASIDE", "AUDIO", "BLOCKQUOTE", "BODY", "CANVAS", "CENTER", "DD", "DIR", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "FRAMESET", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "HTML", "ISINDEX", "LI", "MAIN", "MENU", "NAV", "NOFRAMES", "NOSCRIPT", "OL", "OUTPUT", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"];
  function isBlock(node) {
    return is(node, blockElements);
  }
  var voidElements = ["AREA", "BASE", "BR", "COL", "COMMAND", "EMBED", "HR", "IMG", "INPUT", "KEYGEN", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"];
  function isVoid(node) {
    return is(node, voidElements);
  }
  function hasVoid(node) {
    return has(node, voidElements);
  }
  var meaningfulWhenBlankElements = ["A", "TABLE", "THEAD", "TBODY", "TFOOT", "TH", "TD", "IFRAME", "SCRIPT", "AUDIO", "VIDEO"];
  function isMeaningfulWhenBlank(node) {
    return is(node, meaningfulWhenBlankElements);
  }
  function hasMeaningfulWhenBlank(node) {
    return has(node, meaningfulWhenBlankElements);
  }
  function is(node, tagNames) {
    return tagNames.indexOf(node.nodeName) >= 0;
  }
  function has(node, tagNames) {
    return node.getElementsByTagName && tagNames.some(function(tagName) {
      return node.getElementsByTagName(tagName).length;
    });
  }
  var markdownEscapes = [[/\\/g, "\\\\"], [/\*/g, "\\*"], [/^-/g, "\\-"], [/^\+ /g, "\\+ "], [/^(=+)/g, "\\$1"], [/^(#{1,6}) /g, "\\$1 "], [/`/g, "\\`"], [/^~~~/g, "\\~~~"], [/\[/g, "\\["], [/\]/g, "\\]"], [/^>/g, "\\>"], [/_/g, "\\_"], [/^(\d+)\. /g, "$1\\. "]];
  function escapeMarkdown(string) {
    return markdownEscapes.reduce(function(accumulator, escape) {
      return accumulator.replace(escape[0], escape[1]);
    }, string);
  }
  var rules = {};
  rules.paragraph = {
    filter: "p",
    replacement: function(content) {
      return "\n\n" + content + "\n\n";
    }
  };
  rules.lineBreak = {
    filter: "br",
    replacement: function(content, node, options) {
      return options.br + "\n";
    }
  };
  rules.heading = {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: function(content, node, options) {
      var hLevel = Number(node.nodeName.charAt(1));
      if (options.headingStyle === "setext" && hLevel < 3) {
        var underline = repeat(hLevel === 1 ? "=" : "-", content.length);
        return "\n\n" + content + "\n" + underline + "\n\n";
      } else {
        return "\n\n" + repeat("#", hLevel) + " " + content + "\n\n";
      }
    }
  };
  rules.blockquote = {
    filter: "blockquote",
    replacement: function(content) {
      content = trimNewlines(content).replace(/^/gm, "> ");
      return "\n\n" + content + "\n\n";
    }
  };
  rules.list = {
    filter: ["ul", "ol"],
    replacement: function(content, node) {
      var parent = node.parentNode;
      if (parent.nodeName === "LI" && parent.lastElementChild === node) {
        return "\n" + content;
      } else {
        return "\n\n" + content + "\n\n";
      }
    }
  };
  rules.listItem = {
    filter: "li",
    replacement: function(content, node, options) {
      var prefix = options.bulletListMarker + "   ";
      var parent = node.parentNode;
      if (parent.nodeName === "OL") {
        var start = parent.getAttribute("start");
        var index = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + index : index + 1) + ".  ";
      }
      var isParagraph = /\n$/.test(content);
      content = trimNewlines(content) + (isParagraph ? "\n" : "");
      content = content.replace(/\n/gm, "\n" + " ".repeat(prefix.length));
      return prefix + content + (node.nextSibling ? "\n" : "");
    }
  };
  rules.indentedCodeBlock = {
    filter: function(node, options) {
      return options.codeBlockStyle === "indented" && node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE";
    },
    replacement: function(content, node, options) {
      return "\n\n    " + node.firstChild.textContent.replace(/\n/g, "\n    ") + "\n\n";
    }
  };
  rules.fencedCodeBlock = {
    filter: function(node, options) {
      return options.codeBlockStyle === "fenced" && node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE";
    },
    replacement: function(content, node, options) {
      var className = node.firstChild.getAttribute("class") || "";
      var language = (className.match(/language-(\S+)/) || [null, ""])[1];
      var code = node.firstChild.textContent;
      var fenceChar = options.fence.charAt(0);
      var fenceSize = 3;
      var fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");
      var match;
      while (match = fenceInCodeRegex.exec(code)) {
        if (match[0].length >= fenceSize) {
          fenceSize = match[0].length + 1;
        }
      }
      var fence = repeat(fenceChar, fenceSize);
      return "\n\n" + fence + language + "\n" + code.replace(/\n$/, "") + "\n" + fence + "\n\n";
    }
  };
  rules.horizontalRule = {
    filter: "hr",
    replacement: function(content, node, options) {
      return "\n\n" + options.hr + "\n\n";
    }
  };
  rules.inlineLink = {
    filter: function(node, options) {
      return options.linkStyle === "inlined" && node.nodeName === "A" && node.getAttribute("href");
    },
    replacement: function(content, node) {
      var href = escapeLinkDestination(node.getAttribute("href"));
      var title = escapeLinkTitle(cleanAttribute(node.getAttribute("title")));
      var titlePart = title ? ' "' + title + '"' : "";
      return "[" + content + "](" + href + titlePart + ")";
    }
  };
  rules.referenceLink = {
    filter: function(node, options) {
      return options.linkStyle === "referenced" && node.nodeName === "A" && node.getAttribute("href");
    },
    replacement: function(content, node, options) {
      var href = escapeLinkDestination(node.getAttribute("href"));
      var title = cleanAttribute(node.getAttribute("title"));
      if (title) title = ' "' + escapeLinkTitle(title) + '"';
      var replacement;
      var reference;
      switch (options.linkReferenceStyle) {
        case "collapsed":
          replacement = "[" + content + "][]";
          reference = "[" + content + "]: " + href + title;
          break;
        case "shortcut":
          replacement = "[" + content + "]";
          reference = "[" + content + "]: " + href + title;
          break;
        default:
          var id = this.references.length + 1;
          replacement = "[" + content + "][" + id + "]";
          reference = "[" + id + "]: " + href + title;
      }
      this.references.push(reference);
      return replacement;
    },
    references: [],
    append: function(options) {
      var references = "";
      if (this.references.length) {
        references = "\n\n" + this.references.join("\n") + "\n\n";
        this.references = [];
      }
      return references;
    }
  };
  rules.emphasis = {
    filter: ["em", "i"],
    replacement: function(content, node, options) {
      if (!content.trim()) return "";
      return options.emDelimiter + content + options.emDelimiter;
    }
  };
  rules.strong = {
    filter: ["strong", "b"],
    replacement: function(content, node, options) {
      if (!content.trim()) return "";
      return options.strongDelimiter + content + options.strongDelimiter;
    }
  };
  rules.code = {
    filter: function(node) {
      var hasSiblings = node.previousSibling || node.nextSibling;
      var isCodeBlock = node.parentNode.nodeName === "PRE" && !hasSiblings;
      return node.nodeName === "CODE" && !isCodeBlock;
    },
    replacement: function(content) {
      if (!content) return "";
      content = content.replace(/\r?\n|\r/g, " ");
      var extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? " " : "";
      var delimiter = "`";
      var matches = content.match(/`+/gm) || [];
      while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + "`";
      return delimiter + extraSpace + content + extraSpace + delimiter;
    }
  };
  rules.image = {
    filter: "img",
    replacement: function(content, node) {
      var alt = escapeMarkdown(cleanAttribute(node.getAttribute("alt")));
      var src = escapeLinkDestination(node.getAttribute("src") || "");
      var title = cleanAttribute(node.getAttribute("title"));
      var titlePart = title ? ' "' + escapeLinkTitle(title) + '"' : "";
      return src ? "![" + alt + "](" + src + titlePart + ")" : "";
    }
  };
  function cleanAttribute(attribute) {
    return attribute ? attribute.replace(/(\n+\s*)+/g, "\n") : "";
  }
  function escapeLinkDestination(destination) {
    var escaped = destination.replace(/([<>()])/g, "\\$1");
    return escaped.indexOf(" ") >= 0 ? "<" + escaped + ">" : escaped;
  }
  function escapeLinkTitle(title) {
    return title.replace(/"/g, '\\"');
  }
  function Rules(options) {
    this.options = options;
    this._keep = [];
    this._remove = [];
    this.blankRule = {
      replacement: options.blankReplacement
    };
    this.keepReplacement = options.keepReplacement;
    this.defaultRule = {
      replacement: options.defaultReplacement
    };
    this.array = [];
    for (var key in options.rules) this.array.push(options.rules[key]);
  }
  Rules.prototype = {
    add: function(key, rule) {
      this.array.unshift(rule);
    },
    keep: function(filter) {
      this._keep.unshift({
        filter,
        replacement: this.keepReplacement
      });
    },
    remove: function(filter) {
      this._remove.unshift({
        filter,
        replacement: function() {
          return "";
        }
      });
    },
    forNode: function(node) {
      if (node.isBlank) return this.blankRule;
      var rule;
      if (rule = findRule(this.array, node, this.options)) return rule;
      if (rule = findRule(this._keep, node, this.options)) return rule;
      if (rule = findRule(this._remove, node, this.options)) return rule;
      return this.defaultRule;
    },
    forEach: function(fn) {
      for (var i = 0; i < this.array.length; i++) fn(this.array[i], i);
    }
  };
  function findRule(rules2, node, options) {
    for (var i = 0; i < rules2.length; i++) {
      var rule = rules2[i];
      if (filterValue(rule, node, options)) return rule;
    }
    return void 0;
  }
  function filterValue(rule, node, options) {
    var filter = rule.filter;
    if (typeof filter === "string") {
      if (filter === node.nodeName.toLowerCase()) return true;
    } else if (Array.isArray(filter)) {
      if (filter.indexOf(node.nodeName.toLowerCase()) > -1) return true;
    } else if (typeof filter === "function") {
      if (filter.call(rule, node, options)) return true;
    } else {
      throw new TypeError("`filter` needs to be a string, array, or function");
    }
  }
  function collapseWhitespace(options) {
    var element = options.element;
    var isBlock2 = options.isBlock;
    var isVoid2 = options.isVoid;
    var isPre = options.isPre || function(node2) {
      return node2.nodeName === "PRE";
    };
    if (!element.firstChild || isPre(element)) return;
    var prevText = null;
    var keepLeadingWs = false;
    var prev = null;
    var node = next(prev, element, isPre);
    while (node !== element) {
      if (node.nodeType === 3 || node.nodeType === 4) {
        var text = node.data.replace(/[ \r\n\t]+/g, " ");
        if ((!prevText || / $/.test(prevText.data)) && !keepLeadingWs && text[0] === " ") {
          text = text.substr(1);
        }
        if (!text) {
          node = remove(node);
          continue;
        }
        node.data = text;
        prevText = node;
      } else if (node.nodeType === 1) {
        if (isBlock2(node) || node.nodeName === "BR") {
          if (prevText) {
            prevText.data = prevText.data.replace(/ $/, "");
          }
          prevText = null;
          keepLeadingWs = false;
        } else if (isVoid2(node) || isPre(node)) {
          prevText = null;
          keepLeadingWs = true;
        } else if (prevText) {
          keepLeadingWs = false;
        }
      } else {
        node = remove(node);
        continue;
      }
      var nextNode = next(prev, node, isPre);
      prev = node;
      node = nextNode;
    }
    if (prevText) {
      prevText.data = prevText.data.replace(/ $/, "");
      if (!prevText.data) {
        remove(prevText);
      }
    }
  }
  function remove(node) {
    var next2 = node.nextSibling || node.parentNode;
    node.parentNode.removeChild(node);
    return next2;
  }
  function next(prev, current, isPre) {
    if (prev && prev.parentNode === current || isPre(current)) {
      return current.nextSibling || current.parentNode;
    }
    return current.firstChild || current.nextSibling || current.parentNode;
  }
  var root = typeof window !== "undefined" ? window : {};
  function canParseHTMLNatively() {
    var Parser = root.DOMParser;
    var canParse = false;
    try {
      if (new Parser().parseFromString("", "text/html")) {
        canParse = true;
      }
    } catch (e) {
    }
    return canParse;
  }
  function createHTMLParser() {
    var Parser = function() {
    };
    {
      if (shouldUseActiveX()) {
        Parser.prototype.parseFromString = function(string) {
          var doc = new window.ActiveXObject("htmlfile");
          doc.designMode = "on";
          doc.open();
          doc.write(string);
          doc.close();
          return doc;
        };
      } else {
        Parser.prototype.parseFromString = function(string) {
          var doc = document.implementation.createHTMLDocument("");
          doc.open();
          doc.write(string);
          doc.close();
          return doc;
        };
      }
    }
    return Parser;
  }
  function shouldUseActiveX() {
    var useActiveX = false;
    try {
      document.implementation.createHTMLDocument("").open();
    } catch (e) {
      if (root.ActiveXObject) useActiveX = true;
    }
    return useActiveX;
  }
  var HTMLParser = canParseHTMLNatively() ? root.DOMParser : createHTMLParser();
  function RootNode(input, options) {
    var root2;
    if (typeof input === "string") {
      var doc = htmlParser().parseFromString(
        // DOM parsers arrange elements in the <head> and <body>.
        // Wrapping in a custom element ensures elements are reliably arranged in
        // a single element.
        '<x-turndown id="turndown-root">' + input + "</x-turndown>",
        "text/html"
      );
      root2 = doc.getElementById("turndown-root");
    } else {
      root2 = input.cloneNode(true);
    }
    collapseWhitespace({
      element: root2,
      isBlock,
      isVoid,
      isPre: options.preformattedCode ? isPreOrCode : null
    });
    return root2;
  }
  var _htmlParser;
  function htmlParser() {
    _htmlParser = _htmlParser || new HTMLParser();
    return _htmlParser;
  }
  function isPreOrCode(node) {
    return node.nodeName === "PRE" || node.nodeName === "CODE";
  }
  function Node(node, options) {
    node.isBlock = isBlock(node);
    node.isCode = node.nodeName === "CODE" || node.parentNode.isCode;
    node.isBlank = isBlank(node);
    node.flankingWhitespace = flankingWhitespace(node, options);
    return node;
  }
  function isBlank(node) {
    return !isVoid(node) && !isMeaningfulWhenBlank(node) && /^\s*$/i.test(node.textContent) && !hasVoid(node) && !hasMeaningfulWhenBlank(node);
  }
  function flankingWhitespace(node, options) {
    if (node.isBlock || options.preformattedCode && node.isCode) {
      return {
        leading: "",
        trailing: ""
      };
    }
    var edges = edgeWhitespace(node.textContent);
    if (edges.leadingAscii && isFlankedByWhitespace("left", node, options)) {
      edges.leading = edges.leadingNonAscii;
    }
    if (edges.trailingAscii && isFlankedByWhitespace("right", node, options)) {
      edges.trailing = edges.trailingNonAscii;
    }
    return {
      leading: edges.leading,
      trailing: edges.trailing
    };
  }
  function edgeWhitespace(string) {
    var m = string.match(/^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/);
    return {
      leading: m[1],
      // whole string for whitespace-only strings
      leadingAscii: m[2],
      leadingNonAscii: m[3],
      trailing: m[4],
      // empty for whitespace-only strings
      trailingNonAscii: m[5],
      trailingAscii: m[6]
    };
  }
  function isFlankedByWhitespace(side, node, options) {
    var sibling;
    var regExp;
    var isFlanked;
    if (side === "left") {
      sibling = node.previousSibling;
      regExp = / $/;
    } else {
      sibling = node.nextSibling;
      regExp = /^ /;
    }
    if (sibling) {
      if (sibling.nodeType === 3) {
        isFlanked = regExp.test(sibling.nodeValue);
      } else if (options.preformattedCode && sibling.nodeName === "CODE") {
        isFlanked = false;
      } else if (sibling.nodeType === 1 && !isBlock(sibling)) {
        isFlanked = regExp.test(sibling.textContent);
      }
    }
    return isFlanked;
  }
  var reduce = Array.prototype.reduce;
  function TurndownService(options) {
    if (!(this instanceof TurndownService)) return new TurndownService(options);
    var defaults2 = {
      rules,
      headingStyle: "setext",
      hr: "* * *",
      bulletListMarker: "*",
      codeBlockStyle: "indented",
      fence: "```",
      emDelimiter: "_",
      strongDelimiter: "**",
      linkStyle: "inlined",
      linkReferenceStyle: "full",
      br: "  ",
      preformattedCode: false,
      blankReplacement: function(content, node) {
        return node.isBlock ? "\n\n" : "";
      },
      keepReplacement: function(content, node) {
        return node.isBlock ? "\n\n" + node.outerHTML + "\n\n" : node.outerHTML;
      },
      defaultReplacement: function(content, node) {
        return node.isBlock ? "\n\n" + content + "\n\n" : content;
      }
    };
    this.options = extend({}, defaults2, options);
    this.rules = new Rules(this.options);
  }
  TurndownService.prototype = {
    /**
     * The entry point for converting a string or DOM node to Markdown
     * @public
     * @param {String|HTMLElement} input The string or DOM node to convert
     * @returns A Markdown representation of the input
     * @type String
     */
    turndown: function(input) {
      if (!canConvert(input)) {
        throw new TypeError(input + " is not a string, or an element/document/fragment node.");
      }
      if (input === "") return "";
      var output = process.call(this, new RootNode(input, this.options));
      return postProcess.call(this, output);
    },
    /**
     * Add one or more plugins
     * @public
     * @param {Function|Array} plugin The plugin or array of plugins to add
     * @returns The Turndown instance for chaining
     * @type Object
     */
    use: function(plugin) {
      if (Array.isArray(plugin)) {
        for (var i = 0; i < plugin.length; i++) this.use(plugin[i]);
      } else if (typeof plugin === "function") {
        plugin(this);
      } else {
        throw new TypeError("plugin must be a Function or an Array of Functions");
      }
      return this;
    },
    /**
     * Adds a rule
     * @public
     * @param {String} key The unique key of the rule
     * @param {Object} rule The rule
     * @returns The Turndown instance for chaining
     * @type Object
     */
    addRule: function(key, rule) {
      this.rules.add(key, rule);
      return this;
    },
    /**
     * Keep a node (as HTML) that matches the filter
     * @public
     * @param {String|Array|Function} filter The unique key of the rule
     * @returns The Turndown instance for chaining
     * @type Object
     */
    keep: function(filter) {
      this.rules.keep(filter);
      return this;
    },
    /**
     * Remove a node that matches the filter
     * @public
     * @param {String|Array|Function} filter The unique key of the rule
     * @returns The Turndown instance for chaining
     * @type Object
     */
    remove: function(filter) {
      this.rules.remove(filter);
      return this;
    },
    /**
     * Escapes Markdown syntax
     * @public
     * @param {String} string The string to escape
     * @returns A string with Markdown syntax escaped
     * @type String
     */
    escape: function(string) {
      return escapeMarkdown(string);
    }
  };
  function process(parentNode) {
    var self = this;
    return reduce.call(parentNode.childNodes, function(output, node) {
      node = new Node(node, self.options);
      var replacement = "";
      if (node.nodeType === 3) {
        replacement = node.isCode ? node.nodeValue : self.escape(node.nodeValue);
      } else if (node.nodeType === 1) {
        replacement = replacementForNode.call(self, node);
      }
      join(output, replacement);
      return output;
    }, []);
  }
  function postProcess(output) {
    var self = this;
    this.rules.forEach(function(rule) {
      if (typeof rule.append === "function") {
        join(output, rule.append(self.options));
      }
    });
    return output.join("").replace(/^[\t\r\n]+/, "").replace(/[\t\r\n\s]+$/, "");
  }
  function replacementForNode(node) {
    var rule = this.rules.forNode(node);
    var content = process.call(this, node).join("");
    var whitespace = node.flankingWhitespace;
    if (whitespace.leading || whitespace.trailing) content = content.trim();
    return whitespace.leading + rule.replacement(content, node, this.options) + whitespace.trailing;
  }
  function join(output, replacement) {
    var tail = output.pop() || "";
    var s1 = trimTrailingNewlines(tail);
    var s2 = trimLeadingNewlines(replacement);
    var nls = Math.max(tail.length - s1.length, replacement.length - s2.length);
    var separator = "\n\n".substring(0, nls);
    if (s1) output.push(s1);
    if (separator) output.push(separator);
    if (s2) output.push(s2);
  }
  function canConvert(input) {
    return input != null && (typeof input === "string" || input.nodeType && (input.nodeType === 1 || input.nodeType === 9 || input.nodeType === 11));
  }

  // src/sample-collector.ts
  var SampleCollector = class {
    scope = false;
    level = 0;
    role;
    inputs = [];
    outputs = [];
    heading(text, level) {
      const sample = /(样例|示例|sample|example)/i.test(text), input = /输入|input/i.test(text), output = /输出|output/i.test(text);
      if (sample) {
        if (!this.scope || level <= this.level) this.level = level;
        this.scope = true;
        this.role = input && !output ? "input" : output && !input ? "output" : void 0;
      } else {
        this.role = void 0;
        if (level <= this.level) this.scope = false;
      }
    }
    label(text) {
      if (!this.scope) return;
      const t = text.replace(/\s+/g, "").replace(/[：:]$/, "");
      if (/^(输入|input)\d*$/i.test(t)) this.role = "input";
      else if (/^(输出|output)\d*$/i.test(t)) this.role = "output";
    }
    code(text) {
      if (this.scope && this.role) (this.role === "input" ? this.inputs : this.outputs).push(text);
    }
    finish() {
      if (this.inputs.length !== this.outputs.length) throw new Error("\u8F93\u5165\u8F93\u51FA\u6837\u4F8B\u6570\u91CF\u4E0D\u5339\u914D\uFF0C\u505C\u6B62\u5BFC\u5165\u4EE5\u907F\u514D\u9519\u8BEF\u5173\u8054");
      return this.inputs.map((input, i) => ({ input, output: this.outputs[i] }));
    }
  };

  // src/languages.ts
  var LANGUAGES = {
    cpp: { label: "C++", fileName: "main.cpp", officialLabel: "C++\uFF08g++17\uFF09" },
    c: { label: "C", fileName: "main.c", officialLabel: "C\uFF08gcc8.3.0\uFF09" }
  };
  function requireLanguage(value) {
    if (value === void 0) return "cpp";
    if (value === "cpp" || value === "c") return value;
    throw new Error("\u53EA\u652F\u6301 C++ \u548C C \u8BED\u8A00");
  }

  // src/problem.ts
  var OFFICIAL_ORIGINS = /* @__PURE__ */ new Set(["https://www.lanqiao.cn", "https://lanqiao.cn"]);
  function normalizeCourseUrl(value) {
    if (typeof value !== "string" || value.length > 2e3) throw new Error("\u8BFE\u7A0B URL \u65E0\u6548");
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("\u8BFE\u7A0B URL \u65E0\u6548");
    }
    const course = url.pathname.match(/^\/courses\/(\d{1,10})\/learning\/?$/);
    const units = url.searchParams.getAll("id");
    if (!OFFICIAL_ORIGINS.has(url.origin) || url.username || url.password || !course || units.length !== 1 || !/^\d{1,10}$/.test(units[0])) {
      throw new Error("\u8BFE\u7A0B URL \u65E0\u6548");
    }
    return `${url.origin}/courses/${course[1]}/learning/?id=${units[0]}`;
  }
  function problemId(url) {
    const u = new URL(url);
    const match = u.pathname.match(/^\/problems\/(\d+)\/(?:learning\/?)?$/);
    if (!OFFICIAL_ORIGINS.has(u.origin) || u.username || u.password || !match) throw new Error("\u4E0D\u662F\u53D7\u652F\u6301\u7684\u84DD\u6865\u9898\u76EE URL");
    return match[1];
  }
  function validateProblem(value) {
    const p = value;
    if (!p || p.version !== 1 || typeof p.id !== "string" || !/^\d{1,10}$/.test(p.id) || typeof p.url !== "string" || problemId(p.url) !== p.id) throw new Error("\u9898\u53F7\u6216 URL \u65E0\u6548");
    if (typeof p.title !== "string" || !p.title.trim() || p.title.length > 200 || typeof p.markdown !== "string" || p.markdown.length > 2e6) throw new Error("\u9898\u9762\u6570\u636E\u65E0\u6548\u6216\u8FC7\u5927");
    if (!Array.isArray(p.tests) || p.tests.length > 100 || p.tests.some((t) => !t || typeof t.input !== "string" || typeof t.output !== "string" || t.input.length > 6e5 || t.output.length > 6e5)) throw new Error("\u6837\u4F8B\u6570\u636E\u65E0\u6548\u6216\u8FC7\u5927");
    for (const limit of [p.timeLimit, p.memoryLimit]) if (limit !== void 0 && (!Number.isFinite(limit) || limit <= 0 || limit > 1e9)) throw new Error("\u8FD0\u884C\u9650\u5236\u65E0\u6548");
    const limits = {};
    if (p.limits !== void 0) {
      if (!p.limits || typeof p.limits !== "object" || Array.isArray(p.limits)) throw new Error("\u8BED\u8A00\u8FD0\u884C\u9650\u5236\u65E0\u6548");
      for (const language of ["cpp", "c"]) {
        const value2 = p.limits[language];
        if (value2 === void 0) continue;
        if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) throw new Error("\u8BED\u8A00\u8FD0\u884C\u9650\u5236\u65E0\u6548");
        for (const limit of [value2.timeLimit, value2.memoryLimit]) if (limit !== void 0 && (!Number.isFinite(limit) || limit <= 0 || limit > 1e9)) throw new Error("\u8BED\u8A00\u8FD0\u884C\u9650\u5236\u65E0\u6548");
        limits[language] = { ...value2.timeLimit ? { timeLimit: value2.timeLimit } : {}, ...value2.memoryLimit ? { memoryLimit: value2.memoryLimit } : {} };
      }
    }
    const courseUrl = p.courseUrl === void 0 ? void 0 : normalizeCourseUrl(p.courseUrl);
    if (p.source !== void 0 && p.source !== (courseUrl ? "lanqiao-course" : "lanqiao-oj")) throw new Error("\u9898\u76EE\u6765\u6E90\u4E0E\u94FE\u63A5\u4E0D\u4E00\u81F4");
    return { version: 1, id: p.id, title: p.title.trim(), url: p.url, markdown: p.markdown, tests: p.tests.map((t) => ({ input: t.input, output: t.output })), ...p.source ? { source: p.source } : {}, ...courseUrl ? { courseUrl } : {}, ...p.timeLimit ? { timeLimit: p.timeLimit } : {}, ...p.memoryLimit ? { memoryLimit: p.memoryLimit } : {}, ...Object.keys(limits).length ? { limits } : {} };
  }
  function parseProblem(doc, url) {
    const id = problemId(url), source = doc.querySelector(".markdown-body"), title = doc.querySelector(".course-name")?.textContent?.replace(/^\s*\d+\s*[.、．]\s*/, "").trim();
    if (!source || !title || !source.querySelector("h1,h2,h3,h4")) throw new Error("\u9898\u9762\u672A\u52A0\u8F7D\u3001\u767B\u5F55\u5931\u6548\u6216\u9875\u9762\u7ED3\u6784\u5DF2\u53D8\u5316\uFF0C\u8BF7\u7B49\u5F85\u9875\u9762\u52A0\u8F7D\u540E\u91CD\u8BD5");
    const body = source.cloneNode(true);
    body.querySelectorAll("script,style,iframe,object,embed,form,.btn-copy,.katex-html").forEach((e) => e.remove());
    body.querySelectorAll(".katex").forEach((e) => {
      const tex = e.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (tex) {
        const block = e.parentElement?.classList.contains("katex-display");
        e.textContent = block ? `
$$
${tex}
$$
` : `$${tex}$`;
      }
    });
    body.querySelectorAll("img,a").forEach((e) => {
      const attr = e.tagName.toLowerCase() === "img" ? "src" : "href";
      try {
        const u = new URL(e.getAttribute(attr) || "", url);
        if (!["https:", "http:"].includes(u.protocol)) e.remove();
        else e.setAttribute(attr, u.href);
      } catch {
        e.remove();
      }
    });
    const collector = new SampleCollector();
    for (const e of body.children) {
      if (/^H[1-6]$/.test(e.tagName)) {
        collector.heading(e.textContent || "", Number(e.tagName.slice(1)));
      } else {
        if (e.tagName === "BLOCKQUOTE" || e.tagName === "P") collector.label(e.textContent || "");
        const codes = e.tagName === "PRE" ? [e.querySelector("code") || e] : [...e.querySelectorAll("pre > code")];
        for (const code of codes) collector.code(code.textContent || "");
      }
    }
    const tests = collector.finish();
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" });
    turndown.addRule("table", { filter: "table", replacement: (_content, node) => {
      const descendants = (n, tags) => Array.from(n.childNodes).flatMap((c) => tags.includes(c.nodeName) ? [c] : descendants(c, tags));
      const rows = descendants(node, ["TR"]).map((r) => descendants(r, ["TH", "TD"]).map((c) => (c.textContent || "").trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
      if (!rows.length) return "";
      return "\n\n" + [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n\n";
    } });
    const formulas = [];
    body.querySelectorAll(".katex").forEach((e) => {
      formulas.push(e.textContent || "");
      e.textContent = `LQFORMULA${formulas.length - 1}TOKEN`;
    });
    let markdown = turndown.turndown(body.outerHTML).replace(/LQFORMULA(\d+)TOKEN/g, (_, i) => formulas[Number(i)]);
    const limits = {};
    for (const row of source.querySelectorAll("tr")) {
      const cells = [...row.querySelectorAll("td")].map((e) => (e.textContent || "").trim());
      const language = cells[0] === "C++" ? "cpp" : cells[0] === "C" ? "c" : void 0;
      if (!language) continue;
      const time = cells[1]?.match(/([\d.]+)\s*(ms|s)/), memory = cells[2]?.match(/([\d.]+)\s*M/i);
      limits[language] = { ...time ? { timeLimit: Number(time[1]) * (time[2] === "s" ? 1e3 : 1) } : {}, ...memory ? { memoryLimit: Number(memory[1]) } : {} };
    }
    markdown = `# ${id} ${title}

\u539F\u9898\uFF1A[\u84DD\u6865 OJ ${id}](${url})

${markdown}
`;
    return validateProblem({ version: 1, id, title, url, markdown, tests, ...limits.cpp, limits });
  }

  // src/report.ts
  function interpretReport(value) {
    const r = value;
    if (!r || typeof r !== "object") throw new Error("\u5B98\u65B9\u62A5\u544A\u683C\u5F0F\u53D8\u5316");
    if (r.is_done !== true) return { phase: "judging" };
    return { phase: "done", ...typeof r.status === "string" ? { status: r.status } : {}, ...typeof r.message === "string" ? { message: r.message } : {}, ...typeof r.output_sample === "string" ? { stdout: r.output_sample } : {}, ...typeof r.error_msg === "string" ? { stderr: r.error_msg } : {}, ...r.time !== void 0 ? { time: r.time } : {}, ...r.runtime !== void 0 ? { runtime: r.runtime } : {}, ...r.memory !== void 0 ? { memory: r.memory } : {}, ...r.pass_rate !== void 0 ? { passRate: r.pass_rate } : {}, ...Array.isArray(r.test_cases) ? { testCases: r.test_cases } : {} };
  }
  function httpFailure(status2) {
    if (status2 === 401 || status2 === 403) return `\u767B\u5F55\u5931\u6548\u6216\u6743\u9650\u4E0D\u8DB3\uFF08HTTP ${status2}\uFF09\uFF0C\u8BF7\u5728\u84DD\u6865\u7F51\u9875\u91CD\u65B0\u767B\u5F55\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u63D0\u4EA4\u3002`;
    if (status2 === 429) return "\u64CD\u4F5C\u9891\u7387\u53D7\u9650\uFF08HTTP 429\uFF09\uFF0C\u8BF7\u7A0D\u540E\u624B\u52A8\u91CD\u8BD5\u3002";
    return `\u5B98\u65B9\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${status2}\uFF09\uFF0C\u8BF7\u5728\u7F51\u9875\u67E5\u770B\u8BE6\u60C5\u3002`;
  }

  // src/browser/page-context.ts
  var numeric = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 || typeof value === "string" && /^\d{1,10}$/.test(value) ? String(value) : void 0;
  function resolvePageContext(page) {
    let u;
    try {
      u = new URL(page.location.href);
    } catch {
      return;
    }
    if (!OFFICIAL_ORIGINS.has(u.origin) || u.username || u.password) return;
    const env = page.document.querySelector(".online-judge-env")?.__vue__;
    const ordinary = u.pathname.match(/^\/problems\/(\d{1,10})\/learning\/?$/);
    if (ordinary) {
      const id2 = ordinary[1];
      if (env?.labId !== void 0 && numeric(env.labId) !== id2 || env?.problemId !== void 0 && numeric(env.problemId) !== id2) return;
      return { kind: "problem", id: id2, key: `problem:${id2}`, url: `${u.origin}/problems/${id2}/learning/` };
    }
    const course = u.pathname.match(/^\/courses\/(\d{1,10})\/learning\/?$/), labId = numeric(u.searchParams.get("id"));
    if (!course || !labId || !env) return;
    const model = env.labModel, oj = env.ojLab, id = numeric(oj?.problem_id);
    if (!id || model?.isOjLab !== true || model?.isContest === true || numeric(env.labId) !== labId || numeric(model.lab?.id) !== labId || numeric(oj.lab?.id) !== labId) return;
    if (numeric(model.ojLab?.problem_id) !== id || numeric(model.ojLab?.lab?.id) !== labId) return;
    if (env.problemId !== void 0 && numeric(env.problemId) !== id || model.course?.id !== void 0 && numeric(model.course.id) !== course[1]) return;
    return {
      kind: "course",
      id,
      labId,
      key: `course:${course[1]}:${labId}:${id}`,
      url: `${u.origin}/problems/${id}/learning/`,
      courseUrl: `${u.origin}/courses/${course[1]}/learning/?id=${labId}`
    };
  }

  // src/browser/platform.ts
  var SELECTORS = { environment: ".online-judge-env", debug: "button.debug", submit: "#oj-submit-btn", title: ".course-name", statement: ".markdown-body" };
  function environment(page) {
    const env = page.document.querySelector(SELECTORS.environment)?.__vue__;
    if (!env || typeof env.monacoEditor?.getValue !== "function" || typeof env.monacoEditor?.setValue !== "function" || typeof env.debugOrSubmit !== "function") throw new Error("\u5B98\u65B9\u7F16\u8F91\u5668\u672A\u5C31\u7EEA\u3001\u672A\u767B\u5F55\u6216\u9875\u9762\u7ED3\u6784\u5DF2\u53D8\u5316\uFF0C\u8BF7\u7B49\u5F85\u52A0\u8F7D\u5E76\u68C0\u67E5\u7F51\u9875\u3002");
    return env;
  }
  function editorReadiness(page) {
    try {
      const env = environment(page);
      const debug = page.document.querySelector(SELECTORS.debug), submit = page.document.querySelector(SELECTORS.submit);
      return { editorReady: !!debug && !debug.disabled && !!submit && !submit.disabled && !env.submitting, language: typeof env.language === "string" ? env.language : "" };
    } catch {
      return { editorReady: false, language: "" };
    }
  }
  var OfficialError = class extends Error {
    constructor(message, errorCode) {
      super(message);
      this.errorCode = errorCode;
    }
  };
  async function executeOfficial(page, job, progress, backup) {
    const context = resolvePageContext(page);
    if (!context || context.id !== job.problemId) throw new Error("\u9875\u9762\u9898\u53F7\u4E0E\u4EFB\u52A1\u4E0D\u4E00\u81F4\uFF0C\u6216\u8BFE\u7A0B\u5355\u5143\u5C1A\u672A\u5C31\u7EEA\uFF0C\u5DF2\u505C\u6B62");
    const env = environment(page);
    if (env.submitting) throw new Error("\u7F51\u7AD9\u6B63\u5728\u8FD0\u884C\u6216\u8BC4\u6D4B\uFF0C\u8BF7\u5B8C\u6210\u540E\u624B\u52A8\u91CD\u8BD5");
    const language = requireLanguage(job.language), label = LANGUAGES[language].officialLabel;
    if (env.language !== language) throw new Error(`\u8BF7\u5148\u628A\u5B98\u65B9\u7F51\u9875\u7F16\u8BD1\u8BED\u8A00\u5207\u6362\u4E3A ${label} \u540E\u91CD\u8BD5`);
    const button = page.document.querySelector(job.kind === "debug" ? SELECTORS.debug : SELECTORS.submit);
    if (!button || button.disabled) throw new Error("\u539F\u751F\u8C03\u8BD5/\u63D0\u4EA4\u6309\u94AE\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5\u767B\u5F55\u72B6\u6001\u6216\u7F51\u9875\u6539\u7248");
    backup(env.monacoEditor.getValue());
    env.monacoEditor.setValue(job.code);
    if (env.monacoEditor.getValue() !== job.code) throw new Error("\u5B98\u65B9\u7F16\u8F91\u5668\u4EE3\u7801\u5199\u5165\u6821\u9A8C\u5931\u8D25\uFF0C\u505C\u6B62\u64CD\u4F5C");
    if (env.language !== language) throw new Error("\u4EE3\u7801\u586B\u5165\u671F\u95F4\u7F51\u9875\u8BED\u8A00\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62");
    if (job.kind === "prepare") return { phase: "prepared", message: `\u6700\u65B0\u4EE3\u7801\u5DF2\u586B\u5165\u5B98\u65B9 ${label} \u7F16\u8F91\u5668\uFF0C\u8BF7\u7531\u7528\u6237\u70B9\u51FB\u7F51\u7AD9\u539F\u751F\u300C\u63D0\u4EA4\u68C0\u6D4B\u300D\u3002\u6B64\u72B6\u6001\u4E0D\u8868\u793A\u5DF2\u63D0\u4EA4\u3002` };
    env.inputSample = job.kind === "debug" ? job.input || "" : "";
    return new Promise((resolve, reject) => {
      const proto = page.XMLHttpRequest.prototype;
      const originalOpen = proto.open, originalSend = proto.send;
      const urls = /* @__PURE__ */ new WeakMap(), pollUrls = /* @__PURE__ */ new Set();
      let submissionId, settled = false, judgingSeen = false;
      const finish = (r, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (proto.open === open) proto.open = originalOpen;
        if (proto.send === send) proto.send = originalSend;
        if (error) reject(error);
        else resolve({ ...r, ...submissionId ? { submissionId } : {} });
      };
      const timer = setTimeout(() => finish({ phase: "unknown", message: "\u5B98\u65B9\u8FD0\u884C\u7ED3\u679C\u7B49\u5F85\u8D85\u65F6\uFF1B\u8BF7\u68C0\u67E5\u7F51\u9875\u548C\u63D0\u4EA4\u8BB0\u5F55\uFF0C\u907F\u514D\u91CD\u590D\u63D0\u4EA4\u3002" }), 12e4);
      const open = function(method, url, ...rest) {
        try {
          urls.set(this, new URL(url, page.location.href).href);
        } catch {
        }
        return originalOpen.call(this, method, url, ...rest);
      };
      const send = function(body) {
        const url = urls.get(this) || "";
        const base = `${page.location.origin}/api/v2/problems/${job.problemId}/`;
        let payload;
        try {
          payload = typeof body === "string" ? JSON.parse(body) : null;
        } catch {
        }
        const submitUrl = context.kind === "course" ? `${page.location.origin}/api/v2/labs/${context.labId}/online_judge/submit/` : `${base}submit/`;
        const isSubmit = url === submitUrl;
        const anySubmit = url.startsWith(`${page.location.origin}/api/v2/`) && /\/(?:problems\/\d+|labs\/\d+\/online_judge)\/submit\/(?:\?.*)?$/.test(url);
        if (anySubmit && (!isSubmit || resolvePageContext(page)?.key !== context.key || payload?.language !== language || payload?.submit_content !== job.code || payload?.is_submit !== (job.kind === "submit") || context.kind === "course" && String(payload?.problem_id) !== job.problemId)) {
          finish(void 0, new Error("\u5B98\u65B9\u8BF7\u6C42\u7684\u8BED\u8A00\u3001\u4EE3\u7801\u6216\u64CD\u4F5C\u7C7B\u578B\u4E0E\u5DF2\u786E\u8BA4\u4EFB\u52A1\u4E0D\u4E00\u81F4\uFF0C\u5DF2\u963B\u6B62\u53D1\u9001"));
          if (typeof this.abort === "function") this.abort();
          return;
        }
        const isReport = url === `${base}submit-report/` && submissionId && payload?.submission_id === submissionId && payload?.is_submit === (job.kind === "submit");
        const isPoll = pollUrls.has(url);
        if (isPoll && !judgingSeen) {
          judgingSeen = true;
          progress({ phase: "judging", submissionId, message: "\u7F51\u7AD9\u6B63\u5728\u67E5\u8BE2\u5B98\u65B9\u8FD0\u884C / \u8BC4\u6D4B\u72B6\u6001\u3002" });
        }
        if (isSubmit || isReport || isPoll) {
          if (isSubmit) progress({ phase: "sent", message: "\u8BF7\u6C42\u5DF2\u7531\u7F51\u7AD9\u539F\u751F\u6D41\u7A0B\u53D1\u9001\uFF0C\u7B49\u5F85\u5E73\u53F0\u63A5\u53D7\u3002" });
          this.addEventListener("load", () => {
            if (settled) return;
            if (this.status < 200 || this.status >= 300) {
              finish(void 0, new OfficialError(httpFailure(this.status), this.status === 401 || this.status === 403 ? "login_required" : void 0));
              return;
            }
            if (isPoll && context.kind !== "course") return;
            let data;
            try {
              data = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
            } catch {
              finish(void 0, new Error("\u5B98\u65B9\u54CD\u5E94\u65E0\u6CD5\u89E3\u6790\uFF0C\u53EF\u80FD\u767B\u5F55\u5931\u6548\u6216\u9875\u9762\u6539\u7248"));
              return;
            }
            if (isSubmit) {
              if (typeof data.submission_url !== "string") {
                finish(void 0, new Error("\u5E73\u53F0\u672A\u8FD4\u56DE submission_url\uFF0C\u4E0D\u80FD\u786E\u8BA4\u5DF2\u63A5\u53D7\uFF1B\u8BF7\u68C0\u67E5\u7F51\u9875\u767B\u5F55\u3001\u9A8C\u8BC1\u7801\u6216\u9891\u7387\u9650\u5236"));
                return;
              }
              try {
                const u = new URL(data.submission_url, page.location.origin);
                if (!["https://opcenter.lanqiao.cn", page.location.origin].includes(u.origin) || u.username || u.password) throw new Error();
                submissionId = u.pathname.match(/\/submissions\/([\w-]+)\/?$/)?.[1];
                if (!submissionId) throw new Error();
                pollUrls.add(u.href);
                pollUrls.add(u.href.replace("https://opcenter.lanqiao.cn/api/v1", `${page.location.origin}/opcenter`));
              } catch {
                finish(void 0, new Error("\u5E73\u53F0\u63D0\u4EA4\u8BB0\u5F55\u5730\u5740\u683C\u5F0F\u53D8\u5316\uFF0C\u505C\u6B62\u81EA\u52A8\u8BC6\u522B"));
                return;
              }
              progress({ phase: "accepted", submissionId, message: "\u5E73\u53F0\u5DF2\u63A5\u53D7\uFF0C\u7B49\u5F85\u5B98\u65B9\u8BC4\u6D4B\u5B8C\u6210\u3002" });
            } else {
              const result = interpretReport(data);
              if (result.phase === "done") finish(result);
              else progress({ ...result, submissionId });
            }
          }, { once: true });
          this.addEventListener("error", () => finish({ phase: "unknown", message: "\u5B98\u65B9\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF0C\u65E0\u6CD5\u786E\u8BA4\u5E73\u53F0\u662F\u5426\u6536\u5230\uFF1B\u8BF7\u67E5\u770B\u5B98\u65B9\u8BB0\u5F55\uFF0C\u63D0\u4EA4\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5" }), { once: true });
          this.addEventListener("timeout", () => finish({ phase: "unknown", message: "\u5B98\u65B9\u7F51\u7EDC\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u5148\u67E5\u770B\u7F51\u7AD9\u8BB0\u5F55\u3002" }), { once: true });
        }
        return originalSend.call(this, body);
      };
      proto.open = open;
      proto.send = send;
      try {
        if (env.language !== language) throw new Error("\u7F51\u9875\u8BED\u8A00\u5DF2\u53D8\u5316\uFF0C\u505C\u6B62\u53D1\u9001");
        button.click();
      } catch (error) {
        finish(void 0, error);
      }
    });
  }

  // src/bridge-icon.ts
  var BRIDGE_PATHS = '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5H6.8C5.4 5 5 6 5 7.3v4.1c0 2.7-1 3.8-2.5 4.6C4 16.8 5 17.9 5 20.6v4.1C5 26 5.4 27 6.8 27H8M24 5h1.2c1.4 0 1.8 1 1.8 2.3v4.1c0 2.7 1 3.8 2.5 4.6-1.5.8-2.5 1.9-2.5 4.6v4.1c0 1.3-.4 2.3-1.8 2.3H24"/><path d="M9 22c0-6.4 3.4-10 7-10s7 3.6 7 10M9 22h14M12 17v5m8-5v5M16 12V8"/></g><circle cx="16" cy="7" r="1.8" fill="currentColor"/>';
  var BRIDGE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">${BRIDGE_PATHS}</svg>`;

  // src/browser/dock.ts
  var defaults = () => ({ side: "right", y: 0.5, expanded: false });
  function position(value) {
    const p = value;
    return { side: p?.side === "left" ? "left" : "right", y: typeof p?.y === "number" && Number.isFinite(p.y) ? Math.max(0, Math.min(1, p.y)) : 0.5, expanded: p?.expanded === true };
  }
  function mountDock(page, options) {
    const doc = page.document, element = doc.createElement("div");
    element.id = "lanqiao-bridge";
    const root2 = element.attachShadow({ mode: "open" });
    root2.innerHTML = `<style>
 :host{all:initial;position:fixed;z-index:9999;width:44px;height:54px;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;--paper:light-dark(#fff,#252b35);--ink:light-dark(#233041,#e1e8f3);--muted:light-dark(#5b687a,#afbdcf);--border:light-dark(#dce4ed,#465164);--blue:light-dark(#0869c3,#8ec7ff);color:var(--ink)}
 *{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--blue);outline-offset:3px}svg{display:block;pointer-events:none}
 .handle{display:grid;place-items:center;width:44px;height:54px;padding:5px;border:1px solid var(--border);border-right:0;border-radius:16px 0 0 16px;background:var(--paper);color:var(--blue);box-shadow:0 3px 16px #10243d20;touch-action:none;cursor:grab;user-select:none}
 :host([data-side=left]) .handle{border-left:0;border-right:1px solid var(--border);border-radius:0 16px 16px 0}.handle:active{cursor:grabbing}
 .panel{position:absolute;top:0;right:54px;width:min(264px,calc(100vw - 66px));max-height:calc(100vh - 16px);overflow:auto;padding:15px;border:1px solid var(--border);border-radius:14px;background:var(--paper);box-shadow:0 8px 30px #10243d24}
 :host([data-side=left]) .panel{right:auto;left:54px}.panel[hidden]{display:none}:host([data-dragging]) .panel{visibility:hidden}
 .heading{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-weight:600}.heading svg{width:22px;height:22px;color:var(--blue)}
 .close{margin-left:auto;border:0;border-radius:4px;background:transparent;color:var(--muted);width:28px;height:28px;font-size:20px}
 .import{width:100%;padding:9px;border:0;border-radius:7px;background:#0869c3;color:white;font-weight:500}.import:disabled{opacity:.6;cursor:wait}
 .footer{display:flex;gap:12px;align-items:center;margin-top:12px}.pair{border:0;background:transparent;color:var(--blue);padding:4px 0;margin-left:auto}
 .status{color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere;max-height:110px;overflow:auto;flex:1;font-size:12px}
 @media(pointer:coarse){.close,.pair{min-width:44px;min-height:44px}.import{min-height:44px}}
 </style><div class="panel" id="bridge-panel" hidden><div class="heading">${BRIDGE_ICON}<span>Lanqiao Bridge</span><button type="button" class="close" aria-label="\u6536\u8D77\u63A7\u4EF6">\xD7</button></div><button type="button" class="import" data-action="import">\u5BFC\u5165 VSCode</button><div class="footer"><span class="status" role="status" aria-live="polite"></span><button type="button" class="pair" data-action="pair">\u914D\u5BF9</button></div></div><button type="button" class="handle" aria-label="\u5C55\u5F00 Lanqiao Bridge\uFF1B\u62D6\u52A8\u53EF\u8D34\u8FB9" aria-controls="bridge-panel" aria-expanded="false" title="\u70B9\u51FB\u5C55\u5F00 / \u6536\u8D77 \xB7 \u62D6\u52A8\u8D34\u8FB9">${BRIDGE_ICON}</button>`;
    let state = position(options.read()), drag, moved = false;
    const handle = root2.querySelector(".handle"), panel = root2.querySelector(".panel");
    const clamp = (n, min, max) => Math.max(min, Math.min(Math.max(min, max), n));
    const render = () => {
      element.dataset.side = state.side;
      element.style.left = state.side === "left" ? "0px" : "auto";
      element.style.right = state.side === "right" ? "0px" : "auto";
      panel.hidden = !state.expanded;
      handle.setAttribute("aria-expanded", String(state.expanded));
      handle.setAttribute("aria-label", `${state.expanded ? "\u6536\u8D77" : "\u5C55\u5F00"} Lanqiao Bridge\uFF1B\u62D6\u52A8\u53EF\u8D34\u8FB9`);
      const height = state.expanded ? Math.max(54, panel.offsetHeight || 190) : 54;
      element.style.top = clamp(state.y * Math.max(0, page.innerHeight - 54), 8, page.innerHeight - height - 8) + "px";
    };
    const save = () => options.write({ ...state });
    const toggle = (expanded) => {
      state.expanded = expanded;
      render();
      save();
    };
    handle.addEventListener("click", () => {
      if (moved) {
        moved = false;
        return;
      }
      toggle(!state.expanded);
    });
    root2.querySelector(".close").addEventListener("click", () => {
      toggle(false);
      handle.focus();
    });
    const keydown = (event) => {
      if (event.key === "Escape" && state.expanded) {
        toggle(false);
        handle.focus();
      }
    };
    root2.addEventListener("keydown", keydown);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = element.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: state.side === "left" ? 0 : page.innerWidth - 44, top: parseFloat(element.style.top) || rect.top };
      moved = false;
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag) return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) moved = true;
      if (!moved) return;
      element.dataset.dragging = "";
      element.style.right = "auto";
      element.style.left = clamp(drag.left + event.clientX - drag.x, 0, page.innerWidth - 44) + "px";
      element.style.top = clamp(drag.top + event.clientY - drag.y, 8, page.innerHeight - 62) + "px";
    });
    const endDrag = (event) => {
      if (!drag) return;
      if (moved) {
        state.side = event.clientX < page.innerWidth / 2 ? "left" : "right";
        state.y = clamp(parseFloat(element.style.top) / Math.max(1, page.innerHeight - 54), 0, 1);
      }
      drag = void 0;
      delete element.dataset.dragging;
      render();
      save();
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", (event) => {
      endDrag(event);
      moved = false;
    });
    for (const [action, callback] of [["import", options.importProblem], ["pair", options.pair]]) {
      const button = root2.querySelector(`[data-action="${action}"]`);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          Promise.resolve(callback()).catch((error) => setStatus(String(error))).finally(() => {
            button.disabled = false;
            render();
          });
        } catch (error) {
          setStatus(String(error));
          button.disabled = false;
        }
      });
    }
    function setStatus(text) {
      root2.querySelector(".status").textContent = text;
      render();
    }
    const resize = () => {
      drag = void 0;
      delete element.dataset.dragging;
      render();
    };
    page.addEventListener("resize", resize);
    doc.body.appendChild(element);
    setStatus(options.status);
    return { element, setStatus, reset: () => {
      state = defaults();
      render();
      save();
    }, dispose: () => {
      page.removeEventListener("resize", resize);
      element.remove();
    } };
  }

  // src/browser/userscript.ts
  var worker = crypto.randomUUID();
  var running = false;
  var connection = "\u672A\u914D\u5BF9";
  var nextPoll = 0;
  var actionUntil = 0;
  var dock;
  var activeKey = "";
  function request(route, data, paired = true) {
    const port = GM_getValue("port", 27124);
    const token = GM_getValue("token", "");
    if (paired && !token) return Promise.reject(new Error("\u8BF7\u5148\u5728 VSCode \u6267\u884C\u300CLanqiao: \u914D\u5BF9\u300D"));
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: "POST",
      url: `http://127.0.0.1:${port}${route}`,
      headers: { "Content-Type": "application/json", "X-Lanqiao-Client": "userscript-v1", ...paired ? { Authorization: `Bearer ${token}` } : {} },
      data: JSON.stringify(data),
      timeout: 15e3,
      onload: (r) => {
        try {
          const b = JSON.parse(r.responseText);
          if (r.status !== 200) {
            if (r.status === 401) connection = "\u6388\u6743\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u914D\u5BF9";
            reject(new Error(b.error || `HTTP ${r.status}`));
          } else resolve(b);
        } catch (e) {
          reject(e);
        }
      },
      onerror: () => reject(new Error("\u8FDE\u63A5 VSCode \u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4\u6269\u5C55\u5DF2\u542F\u52A8\u3001\u7AEF\u53E3\u6B63\u786E\uFF08\u9ED8\u8BA4 27124\uFF09\uFF0CTampermonkey \u5141\u8BB8\u672C\u5730\u8FDE\u63A5\u3002")),
      ontimeout: () => reject(new Error("\u8FDE\u63A5 VSCode \u8D85\u65F6"))
    }));
  }
  function status(message) {
    if (message === "\u5DF2\u8FDE\u63A5 VSCode" && Date.now() < actionUntil) return;
    if (message !== "\u5DF2\u8FDE\u63A5 VSCode") actionUntil = Date.now() + 1e4;
    connection = message;
    dock?.setStatus(message);
  }
  async function pair() {
    const input = prompt("\u8F93\u5165 VSCode\u300CLanqiao: \u914D\u5BF9\u300D\u663E\u793A\u7684\u4E00\u6B21\u6027\u914D\u5BF9\u7801\uFF08\u4E0D\u662F\u84DD\u6865\u5BC6\u7801\u6216 Cookie\uFF09\uFF1A");
    if (!input) return;
    try {
      const result = await request("/pair", { code: input.trim() }, false);
      GM_setValue("token", result.token);
      status("\u5DF2\u914D\u5BF9");
    } catch (e) {
      alert(String(e));
    }
  }
  async function poll() {
    if (running || Date.now() < nextPoll || !GM_getValue("token", "")) return;
    const context = resolvePageContext(unsafeWindow);
    if (!context) return;
    const id = context.id;
    running = true;
    try {
      const problemSource = context.kind === "course" ? "lanqiao-course" : "lanqiao-oj";
      const { job } = await request("/poll", { problemId: id, worker, protocol: 3, problemSource, courseUrl: context.courseUrl, ...editorReadiness(unsafeWindow) });
      status("\u5DF2\u8FDE\u63A5 VSCode");
      if (job) {
        status(job.kind === "debug" ? "\u5B98\u65B9\u5728\u7EBF\u8C03\u8BD5\u4E2D\u2026" : job.kind === "submit" ? "\u5B98\u65B9\u63D0\u4EA4\u4E2D\u2026" : "\u586B\u5165\u4EE3\u7801\u2026");
        let chain = Promise.resolve();
        const send = (result) => {
          chain = chain.then(() => request("/result", { id: job.id, worker, result }));
        };
        try {
          if (resolvePageContext(unsafeWindow)?.key !== context.key) throw new Error("\u9875\u9762\u5355\u5143\u5DF2\u5207\u6362\uFF0C\u4EFB\u52A1\u505C\u6B62\uFF0C\u8BF7\u5728\u76EE\u6807\u9898\u76EE\u91CD\u65B0\u64CD\u4F5C");
          const result = await executeOfficial(unsafeWindow, job, send, (code) => GM_setValue(`backup-${id}`, code));
          await chain;
          await request("/result", { id: job.id, worker, result });
          status(result.phase === "done" ? `\u5B98\u65B9\u7ED3\u679C\uFF1A${result.status || result.message || "\u5B8C\u6210"}` : result.message || result.phase);
        } catch (e) {
          await chain.catch(() => {
          });
          await request("/result", { id: job.id, worker, result: { phase: "error", message: String(e), ...e instanceof OfficialError && e.errorCode ? { errorCode: e.errorCode } : {} } }).catch(() => {
          });
          status(String(e));
        }
      }
    } catch (e) {
      status(String(e));
      nextPoll = Date.now() + 1e4;
    } finally {
      running = false;
    }
  }
  function mount() {
    const context = resolvePageContext(unsafeWindow);
    if (!context || !document.querySelector(".course-name") || !document.querySelector(".markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4")) {
      dock?.dispose();
      dock = void 0;
      activeKey = "";
      return;
    }
    if (activeKey !== context.key) {
      activeKey = context.key;
      actionUntil = 0;
      status(GM_getValue("token", "") ? "\u7B49\u5F85\u8FDE\u63A5 VSCode" : "\u672A\u914D\u5BF9");
    }
    if (dock) return;
    dock = mountDock(window, { read: () => GM_getValue("dock-position-v1", null), write: (value) => GM_setValue("dock-position-v1", value), status: connection, pair, importProblem: async () => {
      try {
        const current = resolvePageContext(unsafeWindow);
        if (!current) throw new Error("\u5F53\u524D\u5355\u5143\u5C1A\u672A\u52A0\u8F7D\u4E3A OJ \u9898\u76EE\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
        status("\u6B63\u5728\u63D0\u53D6\u9898\u9762\u2026");
        const p = parseProblem(document, current.url);
        if (resolvePageContext(unsafeWindow)?.key !== current.key) throw new Error("\u63D0\u53D6\u671F\u95F4\u9875\u9762\u5DF2\u5207\u6362\uFF0C\u8BF7\u91CD\u8BD5");
        const source = current.kind === "course" ? "lanqiao-course" : "lanqiao-oj";
        const r = await request("/import", { ...p, source, courseUrl: current.courseUrl });
        status(`${r.created ? "\u5DF2\u521B\u5EFA" : "\u5DF2\u590D\u7528"} ${p.id}\uFF0C\u6837\u4F8B ${p.tests.length} \u7EC4\uFF1B\u5DF2\u6709\u6587\u4EF6\u4FDD\u7559`);
      } catch (e) {
        status(String(e));
      }
    } });
  }
  GM_registerMenuCommand("\u914D\u5BF9 VSCode", () => {
    void pair();
  });
  GM_registerMenuCommand("\u8BBE\u7F6E\u672C\u5730\u7AEF\u53E3", () => {
    const p = Number(prompt("VSCode \u6269\u5C55\u7AEF\u53E3\uFF08\u9ED8\u8BA4 27124\uFF1B\u4E0D\u80FD\u4F7F\u7528 CPH 27121\uFF09", String(GM_getValue("port", 27124))));
    if (Number.isInteger(p) && p >= 1024 && p <= 65535 && p !== 27121) {
      GM_setValue("port", p);
      status("\u7AEF\u53E3\u5DF2\u66F4\u65B0");
    }
  });
  GM_registerMenuCommand("\u6062\u590D\u4E0A\u6B21\u7F51\u9875\u4EE3\u7801", () => {
    try {
      const context = resolvePageContext(unsafeWindow);
      if (!context) throw new Error("\u5F53\u524D OJ \u9898\u76EE\u5C1A\u672A\u5C31\u7EEA");
      const code = GM_getValue(`backup-${context.id}`, null);
      if (code !== null && confirm("\u6062\u590D\u6269\u5C55\u64CD\u4F5C\u524D\u7684\u7F51\u9875\u4EE3\u7801\uFF1F")) environment(unsafeWindow).monacoEditor.setValue(code);
    } catch (e) {
      alert(String(e));
    }
  });
  GM_registerMenuCommand("\u91CD\u7F6E\u6D6E\u7403\u4F4D\u7F6E", () => {
    if (dock) dock.reset();
    else GM_setValue("dock-position-v1", { side: "right", y: 0.5, expanded: false });
  });
  GM_registerMenuCommand("\u6E05\u9664\u672C\u5730\u6388\u6743", () => {
    GM_setValue("token", "");
    status("\u6388\u6743\u5DF2\u6E05\u9664");
  });
  setInterval(() => {
    mount();
    void poll();
  }, 1500);
  mount();
})();
/*
Bundled Turndown license:
MIT License

Copyright (c) 2017 Dom Christie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
