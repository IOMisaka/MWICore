// ==UserScript==
// @name         MWICore
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @description  toolkit, for MilkyWayIdle.一些工具函数，和一些注入对象，市场数据API等。
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

        lang: null,//inject, lang.zh.translation.itemNames['/items/coin']
        buffCalculator: null,//注入buff计算对象
        alchemyCalculator: null,//注入炼金计算对象

        //core市场
        coreMarket: null,//coreMarket.marketData 格式{"/items/apple_yogurt:0":{ask,bid,time}}
        itemNameToHridDict: null,//物品英文名称反查表
        hookCallback: hookCallback,
    };
    window[injectSpace] = io;

    async function patchScript(node) {
        try {
            const scriptUrl = node.src;
            node.remove();
            const response = await fetch(scriptUrl);
            if (!response.ok) throw new Error(`Failed to fetch script: ${response.status}`);

            let sourceCode = await response.text();

            // Define injection points as configurable patterns
            const injectionPoints = [
                {
                    pattern: "Ca.a.use",
                    replacement: `window.${injectSpace}.lang=Oa;Ca.a.use`
                },
                {
                    pattern: "class tp extends s.a.Component{constructor(e){var t;super(e),t=this,",
                    replacement: `class tp extends s.a.Component{constructor(e){var t;super(e),t=this,window.${injectSpace}.game=this,`
                },
                {
                    pattern: "var Q=W;",
                    replacement: `window.${injectSpace}.buffCalculator=W;var Q=W;`
                },
                {
                    pattern: "class Dn",
                    replacement: `window.${injectSpace}.alchemyCalculator=Mn;class Dn`
                },
                {
                    pattern: "var z=q;",
                    replacement: `window.${injectSpace}.actionManager=q;var z=q;`
                }
            ];

            injectionPoints.forEach(({ pattern, replacement }) => {
                if (sourceCode.includes(pattern)) {
                    sourceCode = sourceCode.replace(pattern, replacement);
                }
            });

            const newNode = document.createElement('script');
            newNode.textContent = sourceCode;
            document.body.appendChild(newNode);
            console.log('Script patched successfully.')
        } catch (error) {
            console.error('Script patching failed:', error);
        }
    }
    new MutationObserver((mutationsList, obs) => {
        mutationsList.forEach((mutationRecord) => {
            for (const node of mutationRecord.addedNodes) {
                if (node.src) {
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


    const HOST = "https://mooket.qi-e.top"
    const MWIAPI_URL = "https://raw.githubusercontent.com/holychikenz/MWIApi/main/milkyapi.json";

    class Price {
        bid = -1;
        ask = -1;
        time = -1;
        constructor(bid, ask, time) {
            this.bid = bid;
            this.ask = ask;
            this.time = time;
        }
    }
    class CoreMarket {
        marketData = {};
        constructor() {
            //core data
            let marketDataStr = localStorage.getItem("MWICore_marketData") || "{}";
            this.marketData = JSON.parse(marketDataStr);

            //mwiapi data
            let mwiapiJsonStr = localStorage.getItem("MWIAPI_JSON") || localStorage.getItem("MWITools_marketAPI_json");
            if (mwiapiJsonStr) {
                let mwiapiObj = JSON.parse(mwiapiJsonStr);
                this.mergeData(mwiapiObj);
            } else {
                fetch(MWIAPI_URL).then(res => {
                    res.text().then(mwiapiJsonStr => {
                        let mwiapiJson = JSON.parse(mwiapiJsonStr);
                        this.mergeData(mwiapiJson);
                        //更新本地缓存数据
                        localStorage.setItem("MWIAPI_JSON", mwiapiJsonStr);//更新本地缓存数据
                        console.info("MWIAPI_JSON updated:", new Date(mwiapiJson.time * 1000).toLocaleString());
                    })
                });
            }

            //市场数据上报
            hookCallback(io.game, "handleMessageMarketItemOrderBooksUpdated", (res, obj) => {

                //更新本地
                let timestamp = parseInt(Date.now() / 1000);
                let itemHrid = obj.marketItemOrderBooks.itemHrid;
                obj.marketItemOrderBooks?.orderBooks?.forEach((item, enhancementLevel) => {
                    let bid = item.bids?.length > 0 ? item.bids[0].price : -1;
                    let ask = item.asks?.length > 0 ? item.asks[0].price : -1;
                    this.updateItem(itemHrid, enhancementLevel, new Price(bid, ask, timestamp));
                });
                obj.time = timestamp;
                fetch(`${HOST}/market/upload/order`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(obj)
                });
            })
            setInterval(() => { this.save(); }, 1000 * 600);
        }
        mergeData(obj) {
            Object.entries(obj.market).forEach(([itemName, price]) => {
                let itemHrid = io.itemNameToHridDict[itemName]
                if (itemHrid) this.updateItem(itemHrid, 0, new Price(price.bid, price.ask, obj.time));
            });
            this.save();
        }
        getItemPrice(itemHrid, enhancementLevel = 0) {
            let priceObj = this.marketData[itemHrid + ":" + enhancementLevel];
            if (!priceObj) return null;

            if (priceObj.time > Date.now() / 1000 - 60) return priceObj;//一分钟内直接返回本地数据，防止频繁请求服务器
            setTimeout(() => { this.getItemPriceAsync(itemHrid, enhancementLevel) }, 0);//异步获取最新数据，防止阻塞主线程
            return priceObj;
        }
        async getItemPriceAsync(itemHrid, enhancementLevel = 0) {
            const params = new URLSearchParams();
            params.append("itemHrid", itemHrid);
            params.append("enhancementLevel", enhancementLevel);

            let res = await fetch(`${HOST}/market/item/price?${params}`);
            if (res.status != 200) return this.getItemPrice(itemHrid, enhancementLevel);//兜底逻辑，防止服务器出错
            let priceObj = await res.json();
            this.updateItem(res.itemHrid, res.enhancementLevel, priceObj)
            return priceObj;
        }
        updateItem(itemHrid, enhancementLevel, priceObj) {
            let localItem = this.marketData[itemHrid + ":" + enhancementLevel];
            if (!localItem || localItem.time < priceObj.time) {
                this.marketData[itemHrid + ":" + enhancementLevel] = priceObj;
            }
        }
        save() {
            localStorage.setItem("MWICore_marketData", JSON.stringify(this.marketData));
        }
    }
    function init() {
        io.itemNameToHridDict = {};
        Object.entries(io.lang.en.translation.itemNames).forEach(([k, v]) => { io.itemNameToHridDict[v] = k });
        Object.entries(io.lang.zh.translation.itemNames).forEach(([k, v]) => { io.itemNameToHridDict[v] = k });
        io.coreMarket = new CoreMarket();
    }
    function waitForGame() {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                if (io.game && io.lang) {
                    clearInterval(interval);
                    resolve();
                }
            }, 1000);
        });
    }
    waitForGame().then(() => {
        init();
    });

})();