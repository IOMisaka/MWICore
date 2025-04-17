// ==UserScript==
// @name         MWICore
// @namespace    http://tampermonkey.net/
// @version      0.1.2
// @description  toolkit, for MilkyWayIdle.一些工具函数，和一些注入对象，市场数据API等。
// @author       IOMisaka
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';
    let injectSpace = "mwi";//use window.mwi to access the injected object
    if (window[injectSpace]) return;//已经注入
    let io = {//供外部调用的接口
        version: "0.1.2",//版本号，未改动原有接口只更新最后一个版本号，更改了接口会更改次版本号，主版本暂时不更新，等稳定之后再考虑主版本号更新
        MWICoreInitialized: false,//是否初始化完成，完成会还会通过window发送一个自定义事件 MWICoreInitialized

        /*一些可以直接用的游戏数据，欢迎大家一起来整理
        game.state.levelExperienceTable //经验表
        game.state.skillingActionTypeBuffsDict },
        game.state.characterActions //[0]是当前正在执行的动作，其余是队列中的动作
        */
        game: null,//注入游戏对象，可以直接访问游戏中的大量数据和方法以及消息事件等
        lang: null,//语言翻译, 例如中文物品lang.zh.translation.itemNames['/items/coin']
        buffCalculator: null,//注入buff计算对象buffCalculator.mergeBuffs()合并buffs，计算加成效果等
        alchemyCalculator: null,//注入炼金计算对象


        /* marketJson兼容接口 */
        get marketJson() {
            return this.MWICoreInitialized && new Proxy(this.coreMarket, {
                get(coreMarket, prop) {
                    if (prop === "market") {
                        return new Proxy(coreMarket, {
                            get(coreMarket, itemHridOrName) {
                                return coreMarket.getItemPrice(itemHridOrName);
                            }
                        });
                    }
                    return null;
                }

            });
        },
        coreMarket: null,//coreMarket.marketData 格式{"/items/apple_yogurt:0":{ask,bid,time}}
        itemNameToHridDict: null,//物品名称反查表
        ensureItemHrid: function (itemHridOrName) {
            let itemHrid = this.itemNameToHridDict[itemHridOrName];
            if (itemHrid) return itemHrid;
            if (itemHridOrName?.startsWith("/items/") && this?.game?.state?.itemDetailDict) return itemHridOrName;
            return null;
        },//各种名字转itemHrid，找不到返回原itemHrid或者null
        hookCallback: hookCallback,//hook回调，用于hook游戏事件等 例如聊天消息mwi.hookCallback(mwi.game, "handleMessageChatMessageReceived", (_,obj)=>{console.log(obj)})
        fetchWithTimeout: fetchWithTimeout,//带超时的fetch
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
            console.info('MWICore patched successfully.')
        } catch (error) {
            console.error('MWICore patching failed:', error);
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
    /**
     * 带超时功能的fetch封装
     * @param {string} url - 请求URL
     * @param {object} options - fetch选项
     * @param {number} timeout - 超时时间(毫秒)，默认10秒
     * @returns {Promise} - 返回fetch的Promise
     */
    function fetchWithTimeout(url, options = {}, timeout = 10000) {
        // 创建AbortController实例
        const controller = new AbortController();
        const { signal } = controller;

        // 设置超时计时器
        const timeoutId = setTimeout(() => {
            controller.abort(new Error(`请求超时: ${timeout}ms`));
        }, timeout);

        // 合并选项，添加signal
        const fetchOptions = {
            ...options,
            signal
        };

        // 发起fetch请求
        return fetch(url, fetchOptions)
            .then(response => {
                // 清除超时计时器
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP错误! 状态码: ${response.status}`);
                }
                return response;
            })
            .catch(error => {
                // 清除超时计时器
                clearTimeout(timeoutId);

                // 如果是中止错误，重新抛出超时错误
                if (error.name === 'AbortError') {
                    throw new Error(`请求超时: ${timeout}ms`);
                }
                throw error;
            });
    }

    /*实时市场模块*/
    const HOST = "https://mooket.qi-e.top";
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
        marketData = {};//市场数据，带强化等级，存储格式{"/items/apple_yogurt:0":{ask,bid,time}}
        fetchTimeDict = {};//记录上次API请求时间，防止频繁请求
        ttl = 300;//缓存时间，单位秒

        constructor() {
            //core data
            let marketDataStr = localStorage.getItem("MWICore_marketData") || "{}";
            this.marketData = JSON.parse(marketDataStr);

            //mwiapi data
            let mwiapiJsonStr = localStorage.getItem("MWIAPI_JSON") || localStorage.getItem("MWITools_marketAPI_json");
            let mwiapiObj = null;
            if (mwiapiJsonStr) {
                mwiapiObj = JSON.parse(mwiapiJsonStr);
                this.mergeMWIData(mwiapiObj);
            }
            if (!mwiapiObj || Date.now() / 1000 - mwiapiObj.time > 1800) {//超过半小时才更新，因为mwiapi每小时更新一次，频繁请求github会报错
                fetch(MWIAPI_URL).then(res => {
                    res.text().then(mwiapiJsonStr => {
                        mwiapiObj = JSON.parse(mwiapiJsonStr);
                        this.mergeMWIData(mwiapiObj);
                        //更新本地缓存数据
                        localStorage.setItem("MWIAPI_JSON", mwiapiJsonStr);//更新本地缓存数据
                        console.info("MWIAPI_JSON updated:", new Date(mwiapiObj.time * 1000).toLocaleString());
                    })
                });
            }

            //市场数据更新
            hookCallback(io.game, "handleMessageMarketItemOrderBooksUpdated", (res, obj) => {
                //更新本地
                let timestamp = parseInt(Date.now() / 1000);
                let itemHrid = obj.marketItemOrderBooks.itemHrid;
                obj.marketItemOrderBooks?.orderBooks?.forEach((item, enhancementLevel) => {
                    let bid = item.bids?.length > 0 ? item.bids[0].price : -1;
                    let ask = item.asks?.length > 0 ? item.asks[0].price : -1;
                    this.updateItem(itemHrid + ":" + enhancementLevel, new Price(bid, ask, timestamp));
                });
                //上报数据
                obj.time = timestamp;
                fetchWithTimeout(`${HOST}/market/upload/order`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(obj)
                });
            })
            setInterval(() => { this.save(); }, 1000 * 600);//十分钟保存一次
        }

        /**
         * 合并MWIAPI数据，只包含0级物品
         *
         * @param obj 包含市场数据的对象
         */
        mergeMWIData(obj) {
            Object.entries(obj.market).forEach(([itemName, price]) => {
                let itemHrid = io.ensureItemHrid(itemName);
                if (itemHrid) this.updateItem(itemHrid + ":" + 0, new Price(price.bid, price.ask, obj.time), false);//本地更新
            });
            this.save();
        }
        mergeCoreDataBeforeSave() {
            let obj = JSON.parse(localStorage.getItem("MWICore_marketData") || "{}");
            Object.entries(obj).forEach(([itemHridLevel, priceObj]) => {
                this.updateItem(itemHridLevel, priceObj, false);//本地更新
            });
            //不保存，只合并
        }
        save() {//保存到localStorage
            this.mergeCoreDataBeforeSave();//从其他角色合并保存的数据
            localStorage.setItem("MWICore_marketData", JSON.stringify(this.marketData));
        }

        /**
         * 部分特殊物品的价格
         * 例如金币固定1，牛铃固定为牛铃袋/10的价格
         * @param {string} itemHrid - 物品hrid
         * @returns {Price|null} - 返回对应商品的价格对象，如果没有则null
         */
        getSpecialPrice(itemHrid) {
            switch (itemHrid) {
                case "/items/coin":
                    return new Price(1, 1, Date.now() / 1000);
                case "/items/cowbell": {
                    let cowbells = this.getItemPrice("/items/bag_of_10_cowbells");
                    return cowbells && { bid: cowbells.bid / 10, ask: cowbells.ask / 10, time: cowbells.time };
                }
                default:
                    return null;
            }
        }
        /**
         * 获取商品的价格
         *
         * @param {string} itemHridOrName 商品HRID或名称
         * @param {number} [enhancementLevel=0] 装备强化等级，普通商品默认为0
         * @returns {number|null} 返回商品的价格，如果商品不存在或无法获取价格则返回null
         */
        getItemPrice(itemHridOrName, enhancementLevel = 0) {
            let itemHrid = io.ensureItemHrid(itemHridOrName);
            if (!itemHrid) return null;
            let specialPrice = this.getSpecialPrice(itemHrid);
            if (specialPrice) return specialPrice;

            let priceObj = this.marketData[itemHrid + ":" + enhancementLevel];
            if (Date.now() / 1000 - this.fetchTimeDict[itemHrid + ":" + enhancementLevel] < this.ttl) return priceObj;//1分钟内直接返回本地数据，防止频繁请求服务器
            if (this.fetchCount > 10) return priceObj;//过于频繁请求服务器
            
            this.fetchCount++;
            setTimeout(() => { this.fetchCount--;this.getItemPriceAsync(itemHrid, enhancementLevel); }, this.fetchCount*200);//后台获取最新数据，防止阻塞
            return priceObj;
        }
        fetchCount = 0;//防止频繁请求服务器，后台获取最新数据

        /**
         * 异步获取物品价格
         *
         * @param {string} itemHridOrName 物品HRID或名称
         * @param {number} [enhancementLevel=0] 增强等级，默认为0
         * @returns {Promise<Object|null>} 返回物品价格对象或null
         */
        async getItemPriceAsync(itemHridOrName, enhancementLevel = 0) {
            let itemHrid = io.ensureItemHrid(itemHridOrName);
            if (!itemHrid) return null;
            let specialPrice = this.getSpecialPrice(itemHrid);
            if (specialPrice) return specialPrice;
            let itemHridLevel = itemHrid + ":" + enhancementLevel;
            if (Date.now() / 1000 - this.fetchTimeDict[itemHridLevel] < this.ttl) return this.marketData[itemHridLevel];//1分钟内请求直接返回本地数据，防止频繁请求服务器

            // 构造请求参数
            const params = new URLSearchParams();
            params.append("name", itemHrid);
            params.append("level", enhancementLevel);

            let res = null;
            try {
                this.fetchTimeDict[itemHridLevel] = Date.now() / 1000;//记录请求时间
                res = await fetchWithTimeout(`${HOST}/market/item/price?${params}`);
            } catch (e) {
                return this.marketData[itemHridLevel];//获取失败，直接返回本地数据
            } finally {
                
            }
            if (res.status != 200) {
                return this.marketData[itemHridLevel];//获取失败，直接返回本地数据
            }
            let resObj = await res.json();
            let priceObj = new Price(resObj.bid, resObj.ask, Date.now() / 1000);
            if (resObj.ttl) this.ttl = resObj.ttl;//更新ttl
            this.updateItem(itemHridLevel, priceObj);
            return priceObj;
        }
        updateItem(itemHridLevel, priceObj, isFetch = true) {
            let localItem = this.marketData[itemHridLevel];
            if (isFetch) this.fetchTimeDict[itemHridLevel] = Date.now() / 1000;//fetch时间戳
            if (!localItem || localItem.time < priceObj.time) {//服务器数据更新则更新本地数据
                this.marketData[itemHridLevel] = priceObj;
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
        io.MWICoreInitialized = true;
        window.dispatchEvent(new CustomEvent("MWICoreInitialized"))
        console.info("MWICoreInitialized event dispatched. window.mwi.MWICoreInitialized=true");
    }
    new Promise(resolve => {
        const interval = setInterval(() => {
            if (io.game && io.lang) {//等待必须组件加载完毕后再初始化
                clearInterval(interval);
                resolve();
            }
        }, 100);
    }).then(() => {
        init();
    });

})();