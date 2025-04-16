// ==UserScript==
// @name         MWICore History
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  银河奶牛历史价格 show history market data for milkywayidle
// @author       IOMisaka
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js
// @license MIT
// ==/UserScript==


(function () {
  'use strict';
  if (!window.mwi) {
    console.error("mooket需要安装MWICore插件才能使用");
    return;
  }
  window.addEventListener("MWICoreInitialized", registerHooks);
  function registerHooks() {
    console.info("mooket 初始化完成");
    window.mwi.hookCallback(window.mwi.game, "handleMessageMarketItemOrderBooksUpdated", (_, obj) => {
      requestItemPrice(obj.marketItemOrderBooks.itemHrid, cur_day);
    });
    window.mwi.hookCallback(window.mwi.game, "handleMessageMarketListingsUpdated", (_, obj) => {
      obj.endMarketListings.forEach(order => {
        if (order.filledQuantity == 0) return;//没有成交的订单不记录
        let key = order.itemHrid + "_" + order.enhancementLevel;

        let tradeItem = trade_history[key] || {}
        if (order.isSell) {
          tradeItem.sell = order.price;
        } else {
          tradeItem.buy = order.price;
        }
        trade_history[key] = tradeItem;
      });
      localStorage.setItem("mooket_trade_history", JSON.stringify(trade_history));//保存挂单数据
    });
  }




  let trade_history = JSON.parse(localStorage.getItem("mooket_trade_history") || "{}");

  let cur_day = 1;
  let curHridName = null;
  let curShowItemName = null;
  let w = "500";
  let h = "280";

  let configStr = localStorage.getItem("mooket_config");
  let config = configStr ? JSON.parse(configStr) : { "dayIndex": 0, "visible": true, "filter": { "bid": true, "ask": true, "mean": true } };
  cur_day = config.day;//读取设置

  window.onresize = function () {
    checkSize();
  };
  function checkSize() {
    if (window.innerWidth < window.innerHeight) {
      w = "250";
      h = "400";
    } else {
      w = "400";
      h = "250";
    }
  }
  checkSize();

  // 创建容器元素并设置样式和位置
  const container = document.createElement('div');
  container.style.border = "1px solid #ccc"; //边框样式
  container.style.backgroundColor = "#fff";
  container.style.position = "fixed";
  container.style.zIndex = 10000;
  container.style.top = `${Math.max(0, Math.min(config.y || 0, window.innerHeight - 50))}px`; //距离顶部位置
  container.style.left = `${Math.max(0, Math.min(config.x || 0, window.innerWidth - 50))}px`; //距离左侧位置
  container.style.width = `${Math.max(0, Math.min(config.w || w, window.innerWidth - 50))}px`; //容器宽度
  container.style.height = `${Math.max(0, Math.min(config.h || h, window.innerHeight - 50))}px`; //容器高度
  container.style.resize = "both";
  container.style.overflow = "auto";
  container.style.display = "none";
  container.style.flexDirection = "column";
  container.style.flex = "1";
  container.style.minHeight = "33px";
  container.style.minWidth = "68px";
  container.style.cursor = "move";
  container.style.userSelect = "none";

  let mouseDragging = false;
  let touchDragging = false;
  let offsetX, offsetY;

  let resizeEndTimer = null;
  container.addEventListener("resize", () => {
    if (resizeEndTimer) clearTimeout(resizeEndTimer);
    resizeEndTimer = setTimeout(save_config, 1000);
  });
  container.addEventListener("mousedown", function (e) {
    if (mouseDragging || touchDragging) return;
    const rect = container.getBoundingClientRect();
    if (container.style.resize === "both" && (e.clientX > rect.right - 10 || e.clientY > rect.bottom - 10)) return;
    mouseDragging = true;
    offsetX = e.clientX - container.offsetLeft;
    offsetY = e.clientY - container.offsetTop;
  });

  document.addEventListener("mousemove", function (e) {
    if (mouseDragging) {
      var newX = e.clientX - offsetX;
      var newY = e.clientY - offsetY;

      if (newX < 0) newX = 0;
      if (newY < 0) newY = 0;
      if (newX > window.innerWidth - container.offsetWidth) newX = window.innerWidth - container.offsetWidth;
      if (newY > window.innerHeight - container.offsetHeight) newY = window.innerHeight - container.offsetHeight;

      container.style.left = newX + "px";
      container.style.top = newY + "px";
    }
  });

  document.addEventListener("mouseup", function () {
    mouseDragging = false;
    save_config();
  });

  container.addEventListener("touchstart", function (e) {
    if (mouseDragging || touchDragging) return;
    const rect = container.getBoundingClientRect();
    let touch = e.touches[0];
    if (container.style.resize === "both" && (e.clientX > rect.right - 10 || e.clientY > rect.bottom - 10)) return;
    touchDragging = true;
    offsetX = touch.clientX - container.offsetLeft;
    offsetY = touch.clientY - container.offsetTop;
  });

  document.addEventListener("touchmove", function (e) {
    if (touchDragging) {
      let touch = e.touches[0];
      var newX = touch.clientX - offsetX;
      var newY = touch.clientY - offsetY;

      if (newX < 0) newX = 0;
      if (newY < 0) newY = 0;
      if (newX > window.innerWidth - container.offsetWidth) newX = window.innerWidth - container.offsetWidth;
      if (newY > window.innerHeight - container.offsetHeight) newY = window.innerHeight - container.offsetHeight;

      container.style.left = newX + "px";
      container.style.top = newY + "px";
    }
  });

  document.addEventListener("touchend", function () {
    touchDragging = false;
    save_config();
  });
  document.body.appendChild(container);

  const ctx = document.createElement('canvas');
  ctx.id = "myChart";
  container.appendChild(ctx);



  // 创建下拉菜单并设置样式和位置
  let wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.top = '5px';
  wrapper.style.right = '16px';
  wrapper.style.fontSize = '14px';

  //wrapper.style.backgroundColor = '#fff';
  wrapper.style.flexShrink = 0;
  container.appendChild(wrapper);

  const days = [1, 3, 7, 14, 30, 180, 360];
  const dayTitle = ['1天', '3天', '1周', '2周', '1月', '半年', '一年'];
  cur_day = days[config.dayIndex];

  let select = document.createElement('select');
  select.style.cursor = 'pointer';
  select.style.verticalAlign = 'middle';
  select.onchange = function () {
    cur_day = this.value;
    config.dayIndex = days.indexOf(parseInt(this.value));
    if (curHridName) requestItemPrice(curHridName, cur_day);
    save_config();
  };

  for (let i = 0; i < days.length; i++) {
    let option = document.createElement('option');
    option.value = days[i];
    option.text = dayTitle[i];
    if (i === config.dayIndex) option.selected = true;
    select.appendChild(option);
  }

  wrapper.appendChild(select);

  // 创建一个容器元素并设置样式和位置
  const leftContainer = document.createElement('div');
  leftContainer.style.padding = '2px'
  leftContainer.style.display = 'flex';
  leftContainer.style.flexDirection = 'row';
  leftContainer.style.alignItems = 'center'
  container.appendChild(leftContainer);

  //添加一个btn隐藏canvas和wrapper
  let btn_close = document.createElement('input');
  btn_close.type = 'button';
  btn_close.value = '📈隐藏';
  btn_close.style.margin = 0;
  btn_close.style.cursor = 'pointer';

  leftContainer.appendChild(btn_close);


  //一个固定的文本显示买入卖出历史价格
  let price_info = document.createElement('div');

  price_info.style.fontSize = '14px';
  price_info.title = "我的最近买/卖价格"
  price_info.style.width = "max-content";
  price_info.style.whiteSpace = "nowrap";
  price_info.style.lineHeight = '25px';
  price_info.style.display = 'none';
  price_info.style.marginLeft = '5px';

  let buy_price = document.createElement('span');
  let sell_price = document.createElement('span');
  price_info.appendChild(buy_price);
  price_info.appendChild(sell_price);
  buy_price.style.color = 'red';
  sell_price.style.color = 'green';

  leftContainer.appendChild(price_info);

  let lastWidth;
  let lastHeight;
  btn_close.onclick = toggle;
  function toggle() {
    if (wrapper.style.display === 'none') {
      wrapper.style.display = ctx.style.display = 'block';
      container.style.resize = "both";
      btn_close.value = '📈隐藏';
      leftContainer.style.position = 'absolute'
      leftContainer.style.top = '1px';
      leftContainer.style.left = '1px';
      container.style.width = lastWidth;
      container.style.height = lastHeight;
      config.visible = true;
      save_config();
    } else {
      lastWidth = container.style.width;
      lastHeight = container.style.height;
      wrapper.style.display = ctx.style.display = 'none';
      container.style.resize = "none";
      container.style.width = "auto";
      container.style.height = "auto";


      btn_close.value = '📈显示';
      leftContainer.style.position = 'relative'
      leftContainer.style.top = 0;
      leftContainer.style.left = 0;

      config.visible = false;
      save_config();
    }
  };

  let chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: '市场',
        data: [],
        backgroundColor: 'rgba(255,99,132,0.2)',
        borderColor: 'rgba(255,99,132,1)',
        borderWidth: 1
      }]
    },
    options: {
      onClick: save_config,
      responsive: true,
      maintainAspectRatio: false,
      pointRadius: 0,
      pointHitRadius: 20,
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            // 自定义刻度标签格式化
            callback: showNumber
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: "",
        }
      }
    }
  });

  function requestItemPrice(itemHridName, day = 1) {
    curHridName = itemHridName;
    cur_day = day;

    let itemNameEN = window.mwi.game.state.itemDetailDict[itemHridName].name;


    curShowItemName = localStorage.getItem("i18nextLng")?.startsWith("zh") ?
      window.mwi.lang.zh.translation.itemNames[itemHridName] : window.mwi.lang.en.translation.itemNames[itemHridName];


    let time = day * 3600 * 24;
    fetch("https://mooket.qi-e.top/market", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: itemNameEN,
        time: time
      })
    }).then(res => {
      res.json().then(data => updateChart(data, cur_day));
    })
  }

  function formatTime(timestamp, range) {
    const date = new Date(timestamp * 1000);
    const pad = n => n.toString().padStart(2, '0');

    // 获取各时间组件
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const shortYear = date.getFullYear().toString().slice(-2);

    // 根据时间范围选择格式
    switch (parseInt(range)) {
      case 1: // 1天：只显示时间
        return `${hours}:${minutes}`;

      case 3: // 3天：日+时段
        return `${hours}:${minutes}`;

      case 7: // 7天：月/日 + 时段
        return `${day}.${hours}`;
      case 14: // 14天：月/日 + 时段
        return `${day}.${hours}`;
      case 30: // 30天：月/日
        return `${month}/${day}`;

      default: // 180天：年/月
        return `${shortYear}/${month}`;
    }
  }

  function showNumber(num) {
    if (isNaN(num)) return num;
    if (num === 0) return "0"; // 单独处理0的情况

    const absNum = Math.abs(num);

    //num保留一位小数
    if (num < 1) return num.toFixed(2);

    return absNum >= 1e10 ? `${(num / 1e9).toFixed(1)}B` :
      absNum >= 1e7 ? `${(num / 1e6).toFixed(1)}M` :
        absNum >= 1e4 ? `${Math.floor(num / 1e3)}K` :
          `${Math.floor(num)}`;
  }
  //data={'bid':[{time:1,price:1}],'ask':[{time:1,price:1}]}
  function updateChart(data, day) {
    //过滤异常元素
    for (let i = data.bid.length - 1; i >= 0; i--) {
      if (data.bid[i].price < 0 || data.ask[i].price < 0) {
        data.bid.splice(i, 1);
        data.ask.splice(i, 1);
      }
    }
    //timestamp转日期时间
    //根据day输出不同的时间表示，<3天显示时分，<=7天显示日时，<=30天显示月日，>30天显示年月

    //显示历史价格
    let enhancementLevel = document.querySelector(".MarketplacePanel_infoContainer__2mCnh .Item_enhancementLevel__19g-e")?.textContent.replace("+", "") || "0";
    let tradeName = curHridName + "_" + parseInt(enhancementLevel);
    if (trade_history[tradeName]) {
      let buy = trade_history[tradeName].buy || "无";
      let sell = trade_history[tradeName].sell || "无";
      price_info.style.display = "inline-block";
      let levelStr = enhancementLevel > 0 ? "(+" + enhancementLevel + ")" : "";
      price_info.innerHTML = `<span style="color:red">${showNumber(buy)}</span>/<span style="color:green">${showNumber(sell)}</span>${levelStr}`;
      container.style.minWidth = price_info.clientWidth + 70 + "px";

    } else {
      price_info.style.display = "none";
      container.style.minWidth = "68px";
    }

    let labels = data.bid.map(x => formatTime(x.time, day));

    chart.data.labels = labels;

    let sma = [];
    let sma_size = 6;
    let sma_window = [];
    for (let i = 0; i < data.bid.length; i++) {
      sma_window.push((data.bid[i].price + data.ask[i].price) / 2);
      if (sma_window.length > sma_size) sma_window.shift();
      sma.push(sma_window.reduce((a, b) => a + b, 0) / sma_window.length);
    }
    chart.options.plugins.title.text = curShowItemName
    chart.data.datasets = [
      {
        label: '买入',
        data: data.bid.map(x => x.price),
        borderColor: '#ff3300',
        backgroundColor: '#ff3300',
        borderWidth: 1.5
      },
      {
        label: '卖出',
        data: data.ask.map(x => x.price),
        borderColor: '#00cc00',
        backgroundColor: '#00cc00',
        borderWidth: 1.5
      },
      {
        label: '均线',
        data: sma,
        borderColor: '#ff9900',
        borderWidth: 3,
        tension: 0.5,
        fill: true
      }
    ];
    chart.setDatasetVisibility(0, config.filter.ask);
    chart.setDatasetVisibility(1, config.filter.bid);
    chart.setDatasetVisibility(2, config.filter.mean);

    chart.update()
  }
  function save_config() {

    if (chart && chart.data && chart.data.datasets && chart.data.datasets.length == 3) {
      config.filter.ask = chart.getDatasetMeta(0).visible;
      config.filter.bid = chart.getDatasetMeta(1).visible;
      config.filter.mean = chart.getDatasetMeta(2).visible;
    }
    config.x = Math.max(0, Math.min(container.getBoundingClientRect().x, window.innerWidth - 50));
    config.y = Math.max(0, Math.min(container.getBoundingClientRect().y, window.innerHeight - 50));
    if (container.style.width != "auto") {
      config.w = container.clientWidth;
      config.h = container.clientHeight;
    }

    localStorage.setItem("mooket_config", JSON.stringify(config));
  }
  setInterval(() => {
    if (document.querySelector(".MarketplacePanel_marketplacePanel__21b7o")?.checkVisibility()) {
      container.style.display = "block"
    } else {
      container.style.display = "none"
    }
  }, 500);
  toggle();

})();