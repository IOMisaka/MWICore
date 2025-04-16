// ==UserScript==
// @name         MWICoreAlchemy
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  显示炼金收益 milkywayidle 银河奶牛放置

// @author       IOMisaka
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';
    if (!window.mwi) {
        console.error("MWIAlchemyCalc需要安装MWICore才能使用");
        return;
      }
      
    ////////////////code//////////////////
    function hookWS() {
        const dataProperty = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
        const oriGet = dataProperty.get;
        dataProperty.get = hookedGet;
        Object.defineProperty(MessageEvent.prototype, "data", dataProperty);

        function hookedGet() {
            const socket = this.currentTarget;
            if (!(socket instanceof WebSocket)) {
                return oriGet.call(this);
            }
            if (socket.url.indexOf("api.milkywayidle.com/ws") <= -1 && socket.url.indexOf("api-test.milkywayidle.com/ws") <= -1) {
                return oriGet.call(this);
            }
            const message = oriGet.call(this);
            Object.defineProperty(this, "data", { value: message }); // Anti-loop
            handleMessage(message);
            return message;
        }
    }

    let clientData = null;
    let characterData = null;
    function loadClientData() {
        if (localStorage.getItem("initClientData")) {
            const obj = JSON.parse(localStorage.getItem("initClientData"));
            clientData = obj;
        }
    }

    function handleMessage(message) {
        let obj = JSON.parse(message);
        if (obj) {
            if (obj.type === "init_character_data") {
                characterData = obj;
            } else if (obj.type === "action_type_consumable_slots_updated") {//更新饮料和食物槽数据
                characterData.actionTypeDrinkSlotsMap = obj.actionTypeDrinkSlotsMap;
                characterData.actionTypeFoodSlotsMap = obj.actionTypeFoodSlotsMap;

                handleAlchemyDetailChanged();
            } else if (obj.type === "consumable_buffs_updated") {
                characterData.consumableActionTypeBuffsMap = obj.consumableActionTypeBuffsMap;
                handleAlchemyDetailChanged();
            } else if (obj.type === "community_buffs_updated") {
                characterData.communityActionTypeBuffsMap = obj.communityActionTypeBuffsMap;
                handleAlchemyDetailChanged();
            } else if (obj.type === "equipment_buffs_updated") {//装备buff
                characterData.equipmentActionTypeBuffsMap = obj.equipmentActionTypeBuffsMap;
                characterData.equipmentTaskActionBuffs = obj.equipmentTaskActionBuffs;
                handleAlchemyDetailChanged();
            } else if (obj.type === "house_rooms_updated") {//房屋更新
                characterData.characterHouseRoomMap = obj.characterHouseRoomMap;
                characterData.houseActionTypeBuffsMap = obj.houseActionTypeBuffsMap;
            } else if (obj.type === "action_completed") {//更新技能等级和经验
                if (obj.endCharacterItems) {//道具更新
                    let newIds = obj.endCharacterItems.map(i => i.id);
                    characterData.characterItems = characterData.characterItems.filter(e => !newIds.includes(e.id));//移除存在的物品
                    characterData.characterItems.push(...obj.endCharacterItems);//放入新物品
                }
                if (obj.endCharacterSkills) {
                    for (let newSkill of obj.endCharacterSkills) {
                        let oldSkill = characterData.characterSkills.find(skill => skill.skillHrid === newSkill.skillHrid);

                        oldSkill.level = newSkill.level;
                        oldSkill.experience = newSkill.experience;
                    }
                }
            } else if (obj.type === "items_updated") {
                if (obj.endCharacterItems) {//道具更新
                    let newIds = obj.endCharacterItems.map(i => i.id);
                    characterData.characterItems = characterData.characterItems.filter(e => !newIds.includes(e.id));//移除存在的物品
                    characterData.characterItems.push(...obj.endCharacterItems);//放入新物品
                }
            }
        }
        return message;
    }
    /////////辅助函数,角色动态数据///////////
    // skillHrid = "/skills/alchemy"
    function getSkillLevel(skillHrid, withBuff = false) {
        let skill = characterData.characterSkills.find(skill => skill.skillHrid === skillHrid);
        let level = skill?.level || 0;

        if (withBuff) {//计算buff加成
            level += getBuffValueByType(
                skillHrid.replace("/skills/", "/action_types/"),
                skillHrid.replace("/skills/", "/buff_types/") + "_level"
            );
        }
        return level;
    }

    /// actionTypeHrid = "/action_types/alchemy"
    /// buffTypeHrid = "/buff_types/alchemy_level"
    function getBuffValueByType(actionTypeHrid, buffTypeHrid) {
        let returnValue = 0;
        //社区buff

        for (let buff of characterData.communityActionTypeBuffsMap[actionTypeHrid] || []) {
            if (buff.typeHrid === buffTypeHrid) returnValue += buff.flatBoost;
        }
        //装备buff
        for (let buff of characterData.equipmentActionTypeBuffsMap[actionTypeHrid] || []) {
            if (buff.typeHrid === buffTypeHrid) returnValue += buff.flatBoost;
        }
        //房屋buff
        for (let buff of characterData.houseActionTypeBuffsMap[actionTypeHrid] || []) {
            if (buff.typeHrid === buffTypeHrid) returnValue += buff.flatBoost;
        }
        //茶饮buff
        for (let buff of characterData.consumableActionTypeBuffsMap[actionTypeHrid] || []) {
            if (buff.typeHrid === buffTypeHrid) returnValue += buff.flatBoost;
        }
        return returnValue;
    }
    /**
     * 获取角色ID
     *
     * @returns {string|null} 角色ID，如果不存在则返回null
     */
    function getCharacterId() {
        return characterData?.character.id;
    }
    /**
     * 获取指定物品的数量
     *
     * @param itemHrid 物品的唯一标识
     * @param enhancementLevel 物品强化等级，默认为0
     * @returns 返回指定物品的数量，如果未找到该物品则返回0
     */
    function getItemCount(itemHrid, enhancementLevel = 0) {
        return characterData.characterItems.find(item => item.itemHrid === itemHrid && item.itemLocationHrid === "/item_locations/inventory" && item.enhancementLevel === enhancementLevel)?.count || 0;//背包里面的物品
    }
    //获取饮料状态，传入类型/action_types/brewing,返回列表

    function getDrinkSlots(actionTypeHrid) {
        return characterData.actionTypeDrinkSlotsMap[actionTypeHrid]
    }
    /////////游戏静态数据////////////
    //中英文都有可能
    function getItemHridByShowName(showName) {
        return window.mwi.ensureItemHrid(showName)
    }
    //类似这样的名字blackberry_donut,knights_ingot
    function getItemDataByHridName(hrid_name) {
        return clientData.itemDetailMap["/items/" + hrid_name];
    }
    //类似这样的名字/items/blackberry_donut,/items/knights_ingot
    function getItemDataByHrid(itemHrid) {
        return clientData.itemDetailMap[itemHrid];
    }
    //类似这样的名字Blackberry Donut,Knight's Ingot
    function getItemDataByName(name) {
        return Object.entries(clientData.itemDetailMap).find(([k, v]) => v.name == name);
    }
    function getOpenableItems(itemHrid) {
        let items = [];
        for (let openItem of clientData.openableLootDropMap[itemHrid]) {
            items.push({
                itemHrid: openItem.itemHrid,
                count: (openItem.minCount + openItem.maxCount) / 2 * openItem.dropRate
            });
        }
        return items;
    }
    ////////////观察节点变化/////////////
    function observeNode(nodeSelector, rootSelector, addFunc = null, updateFunc = null, removeFunc = null) {
        const rootNode = document.querySelector(rootSelector);
        if (!rootNode) {
            console.error(`Root node with selector "${rootSelector}" not found.wait for 1s to try again...`);
            setTimeout(() => observeNode(nodeSelector, rootSelector, addFunc, updateFunc, removeFunc), 1000);
            return;
        }
        console.info(`observing "${rootSelector}"`);

        function delayCall(func, observer, delay = 100) {
            //判断func是function类型
            if (typeof func !== 'function') return;
            // 延迟执行，如果再次调用则在原有基础上继续延时
            func.timeout && clearTimeout(func.timeout);
            func.timeout = setTimeout(() => func(observer), delay);
        }

        const observer = new MutationObserver((mutationsList, observer) => {

            mutationsList.forEach((mutation) => {
                mutation.addedNodes.forEach((addedNode) => {
                    if (addedNode.matches && addedNode.matches(nodeSelector)) {
                        addFunc?.(observer);
                    }
                });

                mutation.removedNodes.forEach((removedNode) => {
                    if (removedNode.matches && removedNode.matches(nodeSelector)) {
                        removeFunc?.(observer);
                    }
                });

                // 处理子节点变化
                if (mutation.type === 'childList') {
                    let node = mutation.target.matches(nodeSelector) ? mutation.target : mutation.target.closest(nodeSelector);
                    if (node) {
                        delayCall(updateFunc, observer); // 延迟 100ms 合并变动处理，避免频繁触发
                    }

                } else if (mutation.type === 'characterData') {
                    // 文本内容变化（如文本节点修改）
                    delayCall(updateFunc, observer);
                }
            });
        });


        const config = {
            childList: true,
            subtree: true,
            characterData: true
        };
        observer.reobserve = function () {
            observer.observe(rootNode, config);
        }//重新观察
        observer.observe(rootNode, config);
        return observer;
    }

    loadClientData();//加载游戏数据
    hookWS();//hook收到角色信息

    //模块逻辑代码
    const MARKET_API_URL = "https://raw.githubusercontent.com/holychikenz/MWIApi/main/milkyapi.json";

    let marketData = JSON.parse(localStorage.getItem("MWIAPI_JSON") || localStorage.getItem("MWITools_marketAPI_json") || "{}");//Use MWITools的API数据
    if (!(marketData?.time>Date.now() / 1000 - 86400)) {//如果本地缓存数据过期，则重新获取
        fetch(MARKET_API_URL).then(res => {
            res.json().then(data => {
                marketData = data;
                //更新本地缓存数据
                localStorage.setItem("MWIAPI_JSON", JSON.stringify(data));//更新本地缓存数据
                console.info("MWIAPI_JSON updated:", new Date(marketData.time * 1000).toLocaleString());
            })
        });
    }


    //返回[买,卖]
    function getPrice(itemHrid) {
        return mwi.coreMarket.getItemPrice(itemHrid);   
    }

    //计算每次的收益
    function calculateProfit(data) {
        let profit = 0;
        let input = 0;
        let output = 0;
        let essence = 0;
        let rare = 0;
        let tea = 0;
        let catalyst = 0;


        for (let item of data.inputItems) {//消耗物品每次必定消耗

            input -= getPrice(item.itemHrid).ask * item.count;//买入材料价格*数量

        }
        for (let item of data.teaUsage) {//茶每次必定消耗
            tea -= getPrice(item.itemHrid).ask * item.count;//买入材料价格*数量
        }

        for (let item of data.outputItems) {//产出物品每次不一定产出，需要计算成功率
            output += getPrice(item.itemHrid).bid * item.count * data.successRate;//卖出产出价格*数量*成功率

        }
        if (data.inputItems[0].itemHrid !== "/items/task_crystal") {//任务水晶有问题，暂时不计算
            for (let item of data.essenceDrops) {//精华和宝箱都要算成功率 -> 不,这两个是按采集的时间出
                essence += getPrice(item.itemHrid).bid * item.count;//采集数据的地方已经算进去了
            }
            for (let item of data.rareDrops) {//宝箱也是按自己的几率出 -> 不
                getOpenableItems(item.itemHrid).forEach(openItem => {
                    rare += getPrice(openItem.itemHrid).bid * openItem.count * item.count;//已折算
                });
            }
        }
        //催化剂
        for (let item of data.catalystItems) {//催化剂,成功才会用
            catalyst -= getPrice(item.itemHrid).ask * item.count * data.successRate;//买入材料价格*数量
        }

        profit = input + tea + output + essence + rare + catalyst;
        let description = `Last Update：${new Date(marketData.time * 1000).toLocaleString()}\n(效率+${(data.effeciency * 100).toFixed(2)}%)每次收益${profit}=\n\t材料(${input})\n\t茶(${tea})\n\t催化剂(${catalyst})\n\t产出(${output})\n\t精华(${essence})\n\t稀有(${rare})`;
        //console.info(description);
        return [profit, description];//再乘以次数
    }
    function showNumber(num) {
        if (isNaN(num)) return num;
        if (num === 0) return "0";  // 单独处理0的情况

        const sign = num > 0 ? '+' : '';
        const absNum = Math.abs(num);

        return absNum >= 1e10 ? `${sign}${(num / 1e9).toFixed(1)}B` :
            absNum >= 1e7 ? `${sign}${(num / 1e6).toFixed(1)}M` :
                absNum >= 1e4 ? `${sign}${Math.floor(num / 1e3)}K` :
                    `${sign}${Math.floor(num)}`;
    }
    function parseNumber(str) {
        return parseInt(str.replaceAll("/", "").replaceAll(",", "").replaceAll(" ", ""));
    }
    function handleAlchemyDetailChanged(observer) {
        let inputItems = [];
        let outputItems = [];
        let essenceDrops = [];
        let rareDrops = [];
        let teaUsage = [];
        let catalystItems = [];

        let costNodes = document.querySelector(".AlchemyPanel_skillActionDetailContainer__o9SsW .SkillActionDetail_itemRequirements__3SPnA");
        if (!costNodes) return;//没有炼金详情就不处理

        let costs = Array.from(costNodes.children);
        //每三个元素取textContent拼接成一个字符串，用空格和/分割
        for (let i = 0; i < costs.length; i += 3) {

            let need = parseNumber(costs[i + 1].textContent);
            let nameArr = costs[i + 2].textContent.split("+");
            let itemHrid = getItemHridByShowName(nameArr[0]);
            let enhancementLevel = nameArr.length > 1 ? parseNumber(nameArr[1]) : 0;

            inputItems.push({ itemHrid: itemHrid, enhancementLevel: enhancementLevel, count: need });
        }

        //炼金输出
        for (let line of document.querySelectorAll(".SkillActionDetail_alchemyOutput__6-92q .SkillActionDetail_drop__26KBZ")) {
            let count = parseFloat(line.children[0].textContent.replaceAll(",", ""));
            let itemName = line.children[1].textContent;
            let rate = line.children[2].textContent ? parseFloat(line.children[2].textContent.substring(1, line.children[2].textContent.length - 1) / 100.0) : 1;//默认1
            outputItems.push({ itemHrid: getItemHridByShowName(itemName), count: count * rate });
        }
        //精华输出
        for (let line of document.querySelectorAll(".SkillActionDetail_essenceDrops__2skiB .SkillActionDetail_drop__26KBZ")) {
            let count = parseFloat(line.children[0].textContent);
            let itemName = line.children[1].textContent;
            let rate = line.children[2].textContent ? parseFloat(line.children[2].textContent.substring(1, line.children[2].textContent.length - 1) / 100.0) : 1;//默认1
            essenceDrops.push({ itemHrid: getItemHridByShowName(itemName), count: count * rate });
        }
        //稀有输出
        for (let line of document.querySelectorAll(".SkillActionDetail_rareDrops__3OTzu .SkillActionDetail_drop__26KBZ")) {
            let count = parseFloat(line.children[0].textContent);
            let itemName = line.children[1].textContent;
            let rate = line.children[2].textContent ? parseFloat(line.children[2].textContent.substring(1, line.children[2].textContent.length - 1) / 100.0) : 1;//默认1
            rareDrops.push({ itemHrid: getItemHridByShowName(itemName), count: count * rate });
        }
        //成功率
        let successRateStr = document.querySelector(".SkillActionDetail_successRate__2jPEP .SkillActionDetail_value__dQjYH").textContent;
        let successRate = parseFloat(successRateStr.substring(0, successRateStr.length - 1)) / 100.0;

        //消耗时间
        let costTimeStr = document.querySelector(".SkillActionDetail_timeCost__1jb2x .SkillActionDetail_value__dQjYH").textContent;
        let costSeconds = parseFloat(costTimeStr.substring(0, costTimeStr.length - 1));//秒，有分再改



        //催化剂
        let catalystItem = document.querySelector(".SkillActionDetail_catalystItemInput__2ERjq .Icon_icon__2LtL_")||document.querySelector(".SkillActionDetail_catalystItemInputContainer__5zmou .Item_iconContainer__5z7j4 .Icon_icon__2LtL_");//过程中是另一个框
        if (catalystItem) {
            catalystItems = [{ itemHrid: getItemHridByShowName(catalystItem.getAttribute("aria-label")), count: 1 }];
        }

        //计算效率
        let effeciency = getBuffValueByType("/action_types/alchemy", "/buff_types/efficiency");
        let skillLevel = getSkillLevel("/skills/alchemy", true);
        let mainItem = getItemDataByHrid(inputItems[0].itemHrid);
        if (mainItem.itemLevel) {
            effeciency += Math.max(0, skillLevel - mainItem.itemLevel) / 100;//等级加成
        }

        //costSeconds = costSeconds * (1 - effeciency);//效率，相当于减少每次的时间
        costSeconds = costSeconds / (1 + effeciency);
        //茶饮，茶饮的消耗就减少了
        let teas = getDrinkSlots("/action_types/alchemy");//炼金茶配置
        for (let tea of teas) {
            if (tea) {//有可能空位
                teaUsage.push({ itemHrid: tea.itemHrid, count: costSeconds / 300 });//300秒消耗一个茶
            }
        }
        console.info("效率", effeciency);


        //返回结果
        let ret = {
            inputItems: inputItems,
            outputItems: outputItems,
            essenceDrops: essenceDrops,
            rareDrops: rareDrops,
            successRate: successRate,
            costTime: costSeconds,
            teaUsage: teaUsage,
            catalystItems: catalystItems,
            effeciency: effeciency,
        }

        //次数,收益
        let result = calculateProfit(ret);
        let profit = result[0];
        let desc = result[1];

        let timesPerHour = 3600 / costSeconds;//加了效率相当于增加了次数
        let profitPerHour = profit * timesPerHour;

        let timesPerDay = 24 * timesPerHour;
        let profitPerDay = profit * timesPerDay;

        observer?.disconnect();//断开观察

        //显示位置
        let showParent = document.querySelector(".SkillActionDetail_notes__2je2F");
        let label = showParent.querySelector("#alchemoo");
        if (!label) {
            label = document.createElement("div");
            label.id = "alchemoo";
            showParent.appendChild(label);
        }

        let color = "white";
        if (profitPerHour > 0) {
            color = "lime";
        } else if (profitPerHour < 0) {
            color = "red";
        }
        label.innerHTML = `
        <div id="alchemoo" style="color: ${color};">
            <span title="${desc}">预估收益ℹ️：</span><br/>
            <span>🪙${showNumber(profit)}/次</span><br/>
            <span title="${showNumber(timesPerHour)}次">🪙${showNumber(profitPerHour)}/时</span><br/>
            <span title="${showNumber(timesPerDay)}次">🪙${showNumber(profitPerDay)}/天</span>
            </div>`;

        //console.log(ret);
        observer?.reobserve();
    }
    observeNode(".SkillActionDetail_alchemyComponent__1J55d", ".MainPanel_mainPanel__Ex2Ir", handleAlchemyDetailChanged, handleAlchemyDetailChanged);
})();