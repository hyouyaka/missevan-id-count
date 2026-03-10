<template>

<div class="output">

<!-- 实时状态 -->

<div class="status">

{{ currentAction }}

</div>


<!-- 进度条 -->

<div class="progress">

<div
class="bar"
:style="{ width: progress + '%' }"
></div>

</div>


<!-- 剧集统计 -->

<div v-if="dramaResults.length">

<div
class="dramaLine"
v-for="d in dramaResults"
:key="d.id"
>

{{ d.title }} - 弹幕总数：{{ d.danmaku }} - 去重ID数：{{ d.users }}

</div>

</div>


<!-- 最终结果 -->

<div v-if="totalDanmaku>0" class="final">

<div>

全部弹幕数: {{ totalDanmaku }}

</div>

<div>

整体不重复ID数: {{ totalUsers }}

</div>

</div>

</div>

</template>

<script>

export default {

props:{

progress:Number,

currentAction:String,

dramaResults:{
type:Array,
default:()=>[]
},

totalDanmaku:Number,

totalUsers:Number

}

}

</script>

<style>

.output{

background:#f3f3f3;

border-radius:8px;

padding:12px;

margin-top:12px;

font-family:system-ui;

word-break:break-word;

}


.status{

color:#3f51b5;

font-weight:bold;

margin-bottom:8px;

}


.progress{

height:10px;

background:#ddd;

border-radius:6px;

overflow:hidden;

margin-bottom:10px;

}


.bar{

height:100%;

background:#4caf50;

transition:width 0.3s;

}


.dramaLine{

padding:4px 0;

border-bottom:1px solid #e0e0e0;

}


.final{

margin-top:10px;

font-weight:bold;

color:#2e7d32;

}

</style>