
// eslint-disable-next-line no-unused-vars
class InPageTranslation {

    constructor(mediator) {
        this.translationsCounter = 0;
        this.mediator = mediator;
        this.started = false;
        this.language = null;
        this.viewportNodeMap = new Map();
        this.hiddenNodeMap = new Map();
        this.nonviewportNodeMap = new Map();
        this.updateMap = new Map();
        this.updateTimeout = null;
        this.UI_UPDATE_INTERVAL = 500;
        this.messagesSent = new Set();
        this.nodesSent = new Set();

        // Tags that are treated as "meh inline tags just send them to the translator"
        this.inlineTags = new Set([
            "abbr",
            "a",
            "b",
            "em",
            "i",
            "kbd",
            "code",
            "mark",
            "math",
            "output",
            "q",
            "ruby",
            "small",
            // "span", // removed because Amazon uses it as a div. We now look at if 'display:contents'
            "strong",
            "sub",
            "sup",
            "time",
            "u",
            "var",
            "wbr",
            "ins",
            "del",

            // Not really but for testing, also bergamot-translator treats them as sentece-breaking anyway
            "th",
            "td",
            "li",
            "br"
        ]);

        // Tags that we are allowed to enter (& submit if deemed necessary)
        this.selectedTags = new Set([
            // At least include all the inline tags we know
            ...this.inlineTags,
            "div",
            "p",
            "span",
            // "#text",
            "i",
            "a",
            "b",
            "strong",
            "em",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "form",
            "label",
            "body",
            "header",
            "footer",
            "main",
            "article",
            "section", // too large?
            "nav",
            // "li", // moved to inline
            "ul",
            "ol",
            "dl",
            "dt",
            "dd",
            "td",
            "th",
            "caption",
            "button",
            "select",
            "option",
            "fieldset",
            "legend",

            "summary",
            "details",

            // Allow it to enter tables at least
            "table",
            "thead",
            "tbody",
            "tr",
        ]);

    }

    start(language) {

        /*
         * start the dom parser, the DOM mutation observer and request the
         * title to be translated
         */
        this.started = true;
        this.addDebugStylesheet();

        // Language we expect. If we find elements that do not match, nope out.
        this.language = language;

        const pageTitle = document.getElementsByTagName("title")[0];
        if (pageTitle) {
            this.queueTranslation(pageTitle);
        }
        this.startTreeWalker(document.body);
        this.startMutationObserver();
    }

    addDebugStylesheet() {
        const element = document.createElement('style');
        document.head.appendChild(element);

        const sheet = element.sheet;
        sheet.insertRule('html[x-bergamot-debug] [x-bergamot-translated] { border: 2px solid red; }', 0);
        sheet.insertRule('html[x-bergamot-debug] [x-bergamot-translated~="skipped"] { border: 2px solid purple; }', 1);
        sheet.insertRule('html[x-bergamot-debug] [x-bergamot-translated~="rejected"] { border: 2px solid yellow; }', 2);
        sheet.insertRule('html[x-bergamot-debug] [x-bergamot-translated=""] { border: 2px solid blue; }', 3);
    }

    startTreeWalker(root) {
        const acceptNode = node => {
            return this.validateNode(node);
        }

        const nodeIterator = document.createTreeWalker(
            root,
            // eslint-disable-next-line no-bitwise
            NodeFilter.SHOW_ELEMENT,
            acceptNode
        );

        let currentNode;
        // eslint-disable-next-line no-cond-assign
        while (currentNode = nodeIterator.nextNode()) {
            // console.log('startTreeWalker - root:', root, 'currentnode', currentNode, 'nodehidden:', this.isElementHidden(currentNode.parentNode), 'nodeinViewPort:', this.isElementInViewport(currentNode.parentNode), 'nodeType:', currentNode.nodeType, 'tagName:', currentNode.tagName, 'content:', currentNode.innerHTML, 'wholeText:', currentNode.wholeText.trim());
            this.queueTranslation(currentNode);
        }

        this.dispatchTranslations();
    }

    isElementInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    isElementHidden(element) {
        return element.style.display === "none" || element.style.visibility === "hidden" || element.offsetParent === null;
    }

    isParentTranslating(node){
        /*
         * if the parent of the node is already translating we should reject
         * it since we already sent it to translation
         */

        // if the immediate parent is the body we just allow it
        if (node.parentNode === document.body) {
            return false;
        }

        // let's iterate until we find either the body or if the parent was sent
        let lastNode = node;
        while (lastNode.parentNode) {
            // console.log("isParentTranslating node", node, " isParentTranslating nodeParent ", lastNode.parentNode);
            if (this.nodesSent.has(lastNode.parentNode)) {
                return true;
            }
            lastNode = lastNode.parentNode;
        }

        return false;
    }

    hasInlineContent(node) {
        let inlineElements = 0;
        let blockElements = 0;

        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case 3: // TextNode
                    if (child.textContent.trim().length > 0)
                        inlineElements++;
                    break;

                case 1: // Element
                    if (this.inlineTags.has(child.nodeName.toLowerCase()) 
                        || child.nodeName.toLowerCase() == 'span' && this.hasInlineContent(child))
                        inlineElements++;
                    else
                        blockElements++;
                    break;
            }
        }

        return inlineElements >= blockElements;
    }

    hasTextNodes(node) {
        // TODO There is probably a quicker way to do this
        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case 3: // TextNode
                    if (child.textContent.trim() !== "")
                        return true;
                    break;
            }
        }

        return false;
    }

    isExcludedNode(node) {
        // Exclude elements that have a lang attribute that mismatches the
        // language we're currently translating.
        if (node.lang && node.lang.substr(0.2) !== this.language)
            return true;

        // Exclude CODE blocks
        if (node.nodeName === 'CODE')
            return true;

        return false;
    }

    containsExcludedNode(node) {
        // TODO describe this in terms of the function above, but I assume
        // using querySelector is faster for now.
        return node.querySelector(`[lang]:not([lang|="${this.language}"]), code`);
    }

    validateNode(node) {
        if (!this.selectedTags.has(node.nodeName.toLowerCase())) {
            node.setAttribute('x-bergamot-translated', 'rejected not-in-selected-tags');
            return NodeFilter.FILTER_REJECT;
        }

        if (this.isExcludedNode(node)) {
            node.setAttribute('x-bergamot-translated', 'rejected is-excluded-node');
            return NodeFilter.FILTER_REJECT;
        }

        if (node.textContent.trim().length === 0) {
            node.setAttribute('x-bergamot-translated', 'rejected empty-text-content');
            return NodeFilter.FILTER_REJECT;
        }
        
        if (this.isParentTranslating(node)) {
            node.setAttribute('x-bergamot-translated', 'rejected is-parent-translating');
            return NodeFilter.FILTER_REJECT;
        }

        if (!this.hasInlineContent(node)) {
            node.setAttribute('x-bergamot-translated', 'skipped does-not-have-text-of-its-own');
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper
        } 

        if (this.containsExcludedNode(node) && !this.hasTextNodes(node)) {
            node.setAttribute('x-bergamot-translated', 'skipped contains-excluded-node');
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper  
        }
        
        return NodeFilter.FILTER_ACCEPT; // send whole node as 1 block
    }

    queueTranslation(node) {

        /*
         * let's store the node to keep its reference
         * and send it to the translation worker
         */
        this.translationsCounter += 1;

        // Debugging: mark the node so we can add CSS to see them
        node.setAttribute('x-bergamot-translated', this.translationsCounter);

        // let's categorize the elements on their respective hashmaps
        if (this.isElementHidden(node)) {
            // if the element is entirely hidden
            this.hiddenNodeMap.set(this.translationsCounter, node);
        } else if (this.isElementInViewport(node)) {
            // if the element is present in the viewport
            this.viewportNodeMap.set(this.translationsCounter, node);
        } else {
            // if the element is visible but not present in the viewport
            this.nonviewportNodeMap.set(this.translationsCounter, node);
        }
        this.nodesSent.add(node);
    }

    dispatchTranslations() {
        // we then submit for translation the elements in order of priority
        this.processingNodeMap = "viewportNodeMap";
        this.viewportNodeMap.forEach(this.submitTranslation, this);
        this.processingNodeMap = "nonviewportNodeMap";
        this.nonviewportNodeMap.forEach(this.submitTranslation, this);
        this.processingNodeMap = "hiddenNodeMap";
        this.hiddenNodeMap.forEach(this.submitTranslation, this);
    }

    submitTranslation(node, key) {
        if (this.messagesSent.has(key)) {
            // if we already sent this message, we just skip it
            return;
        }
        const text = node.innerHTML;
        if (text.trim().length) {

          /*
           * send the content back to mediator in order to have the translation
           * requested by it
           */
          const payload = {
            text,
            type: "inpage",
            attrId: [
                     this.processingNodeMap,
                     key
                    ],
          };
          this.notifyMediator("translate", payload);
          this.messagesSent.add(key);
        }
    }

    notifyMediator(command, payload) {
        this.mediator.contentScriptsMessageListener(this, { command, payload });
    }

    startMutationObserver() {
        // select the node that will be observed for mutations
        const targetNode = document;

        // options for the observer (which mutations to observe)
        const config = { attributes: true, childList: true, subtree: true };
        // callback function to execute when mutations are observed
        const callback = function(mutationsList) {
            for (const mutation of mutationsList) {
                if (mutation.type === "childList") {
                    // console.log(mutation);
                    mutation.addedNodes.forEach(node => this.startTreeWalker(node));
                }
            }
        }.bind(this);

        // create an observer instance linked to the callback function
        const observer = new MutationObserver(callback);

        // start observing the target node for configured mutations
        observer.observe(targetNode, config);
    }

    mediatorNotification(translationMessage) {

        /*
         * notification received from the mediator with our request.
         * the only possible notification can be a translation response,
         * so let's schedule the update of the original node with its new content
         */
        this.enqueueElement(translationMessage);
    }

    updateElements() {
        const updateElement = (translatedHTML, node) => {
            node.setAttribute('x-bergamot-translated', '');
            node.innerHTML = translatedHTML;
        }
        this.updateMap.forEach(updateElement);
        this.updateMap.clear();
        this.updateTimeout = null;
    }

    enqueueElement(translationMessage) {
        const [
               hashMapName,
               idCounter
              ] = translationMessage.attrId;
        const translatedText = translationMessage.translatedParagraph;
        // console.log("no enqueue", translatedText);
        let targetNode = null;
        switch (hashMapName) {
            case "hiddenNodeMap":
                targetNode = this.hiddenNodeMap.get(idCounter);
                this.hiddenNodeMap.delete(idCounter);
                break;
            case "viewportNodeMap":
                targetNode = this.viewportNodeMap.get(idCounter);
                this.viewportNodeMap.delete(idCounter);
                break;
            case "nonviewportNodeMap":
                targetNode = this.nonviewportNodeMap.get(idCounter);
                this.nonviewportNodeMap.delete(idCounter);
                break;
            default:
                break;
        }
        this.messagesSent.delete(idCounter);
        this.updateMap.set(targetNode, translatedText);
        // we finally schedule the UI update
        if (!this.updateTimeout) {
            this.updateTimeout = setTimeout(this.updateElements.bind(this),this.UI_UPDATE_INTERVAL);
        }
    }
}