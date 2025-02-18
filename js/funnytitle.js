// 浏览器搞笑标题  快回来!!! 终于回来了
// Based on: https://static.likepoems.com/cdn/javascript/onfocus.js
var OriginTitle = document.title;
var titleTime;
document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        $('[rel="icon"]').attr('href', "/favicon.ico");
        document.title = '╭(°A°`)╮ 我的笋快回来?!';
        clearTimeout(titleTime);
    }
    else {
        $('[rel="icon"]').attr('href', "/favicon.ico");
        document.title = '(ฅ>ω<*ฅ) 笋回来啦!';
        titleTime = setTimeout(function () {
            document.title = OriginTitle;
        }, 2000);
    }
});