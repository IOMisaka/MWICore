// ==UserScript==
// @name         MWICore
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @description  toolkit
// @author       IOMisaka
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';
    let injectSpace = "mwi";//use window.mwi to access the injected object
    if (window[injectSpace]) return;//已经注入
    let io = {//供外部调用的接口
        //游戏对象
        get levelExperienceTable() { return this.game.state.levelExperienceTable },//经验表
        get skillingActionTypeBuffsDict() { return this.game.state.skillingActionTypeBuffsDict },
        get characterActions() { return this.game.state.characterActions },//[0]是当前正在执行的动作，其余是队列中的动作

        lang: null,//inject, lang.cn.translation.itemNames['/items/coin']
        buffCalculator: null,//注入buff计算对象
        alchemyCalculator: null,//注入炼金计算对象
        
        //core市场
        coreMarket: null,//coreMarket.marketData 格式{"/items/apple_yogurt:0":{ask,bid,time}}

        hookCallback: hookCallback,
    };
    window[injectSpace] = io;

    async function patchScript(node) {
        node.remove();
        let sourceCode = await (await fetch(node.src)).text();
        /////////////////patching code here////////////////////
        //注入语言表
        sourceCode = sourceCode.replace("Ca.a.use", `window.${injectSpace}.lang=Oa;Ca.a.use`);
        /*
        游戏对象,各种状态，事件处理都可以在里面找到
        mwi.game.state
        */
        sourceCode = sourceCode.replace("class tp extends s.a.Component{constructor(e){var t;super(e),t=this,", `class tp extends s.a.Component{constructor(e){var t;super(e),t=this,window.${injectSpace}.game=this,`);
        //注入buff计算对象
        sourceCode = sourceCode.replace("var Q=W;", `window.${injectSpace}.buffCalculator=W;var Q=W;`);
        //注入炼金计算对象
        sourceCode = sourceCode.replace("class Dn", `window.${injectSpace}.alchemyCalculator=Mn;class Dn`);
        //注入动作管理器
        sourceCode = sourceCode.replace("var z=q;", `window.log=()=>console.log("test");window.${injectSpace}.actionManager=q;var z=q;`);
        ///////////////////////////////////////////////////////

        console.log("script patched");
        const newNode = document.createElement('script');
        newNode.innerHTML = sourceCode;
        document.body.appendChild(newNode);
    }
    new MutationObserver((mutationsList, obs) => {
        mutationsList.forEach((mutationRecord) => {
            for (const node of mutationRecord.addedNodes) {
                if (node.src) {
                    console.log(node.src);
                    if (node.src.endsWith('main.aecc7346.chunk.js')) {
                        obs.disconnect();
                        patchScript(node);
                    }
                }
            }
        });
    }).observe(document, { childList: true, subtree: true });

    /**
     * Hook回调函数并添加后处理
     * @param {Object} targetObj 目标对象
     * @param {string} callbackProp 回调属性名
     * @param {Function} handler 后处理函数
     */
    function hookCallback(targetObj, callbackProp, handler) {
        const originalCallback = targetObj[callbackProp];

        if (!originalCallback) {
            throw new Error(`Callback ${callbackProp} does not exist`);
        }

        targetObj[callbackProp] = function (...args) {
            const result = originalCallback.apply(this, args);

            // 异步处理
            if (result && typeof result.then === 'function') {
                return result.then(res => {
                    handler(res, ...args);
                    return res;
                });
            }

            // 同步处理
            handler(result, ...args);
            return result;
        };

        // 返回取消Hook的方法
        return () => {
            targetObj[callbackProp] = originalCallback;
        };
    }


    function getItemPrice(itemHrid, enhancementLevel) {
        fetch("https://mooket.qi-e.top/market/upload/order", {
            method: "GET",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ itemHrid: itemHrid, enhancementLevel: enhancementLevel })
        }).then(res => res.json()).then(data => {

        })

    }

    function waitForGame() {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                if (io.game) {
                    clearInterval(interval);
                    resolve();
                }
            }, 1000);
        });
    }
    waitForGame().then(() => {
        init();
    });

    class CoreMarket {
        marketData = {};
        constructor() {
            let marketDataStr = localStorage.getItem("MWICore_marketData") || "{}";
            marketData = JSON.parse(marketDataStr);

            //市场数据上报
            hookCallback(io.game, "handleMessageMarketItemOrderBooksUpdated", (res, obj) => {
                fetch("https://mooket.qi-e.top/market/upload/order", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(obj)
                });
            })
        }
        getItemPrice(itemHrid, enhancementLevel) {
            return this.marketData[itemHrid + ":" + enhancementLevel];
        }
        async getItemPriceAsync(itemHrid, enhancementLevel) {
            if (this.marketData[itemHrid + ":" + enhancementLevel]) return this.marketData[itemHrid + ":" + enhancementLevel];
            let res = await fetch("https://mooket.qi-e.top/market/upload/order", {
                method: "GET",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ itemHrid: itemHrid, enhancementLevel: enhancementLevel })
            });
            res = await res.json();
            return res;
        }
        save() {
            localStorage.setItem("MWICore_marketData", JSON.stringify(this.marketData));
        }
    }
    function init() {
        io.market = new CoreMarket();

    }
})();