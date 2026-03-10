<template>

<div class="panel">

<div class="controls">

<button @click="selectAll">全选</button>
<button @click="clearAll">全不选</button>
<button @click="selectPaid">全选付费集</button>

</div>

<div
v-for="drama in dramas"
:key="drama.drama.id"
>

<div
class="title"
@click="drama.expanded=!drama.expanded"
>

{{drama.drama.name}}

</div>

<div v-show="drama.expanded">

<div
v-for="ep in drama.episodes.episode"
:key="ep.sound_id"
>

<input
type="checkbox"
v-model="ep.selected"
/>

{{ep.name}}
<span v-if="ep.need_pay">（付费）</span>

</div>

</div>

</div>

<button @click="start">
开始统计
</button>

</div>

</template>

<script>

export default{

props:["dramas"],

methods:{

selectAll(){

this.dramas.forEach(d=>
d.episodes.episode.forEach(e=>e.selected=true)
)

},

clearAll(){

this.dramas.forEach(d=>
d.episodes.episode.forEach(e=>e.selected=false)
)

},

selectPaid(){

this.dramas.forEach(d=>
d.episodes.episode.forEach(e=>{
e.selected = e.need_pay == 1
})
)

},

start(){

const ids=[]

this.dramas.forEach(d=>
d.episodes.episode.forEach(e=>{
if(e.selected) ids.push(e.sound_id)
})
)

this.$emit("startStatistics",ids)

}

}

}

</script>

<style>

.panel{

max-height:320px;
overflow-y:auto;
border:1px solid #ddd;
padding:8px;
margin-top:10px;

}

.controls{

margin-bottom:6px;

}

.title{

font-weight:bold;
cursor:pointer;

}

button{

margin:6px 4px;

}

</style>