<template>

<div class="panel">

<div class="buttons">

<button @click="selectAll">全选</button>
<button @click="clearAll">全不选</button>
<button @click="selectPaid">全选付费集</button>
<button class="start-btn" @click="start">开始统计</button>

</div>

<div class="episode-list">
<div
v-for="drama in dramas"
:key="drama.drama.id"
>

<div class="drama-header" @click="toggle(drama)">
  <span class="toggle-icon">
    {{ drama.expanded ? "[-]" : "[+]" }}
  </span>

  <span class="drama-title">
    {{ drama.drama.name }}
  </span>
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

</div>
</div>
</template>

<script>

export default{

props:["dramas"],

methods:{

  toggle(drama){
    drama.expanded = !drama.expanded
  },

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

  border:1px solid #e5e5e5;
  border-radius:10px;
  margin-top:12px;
  background:white;

}

.buttons{

  position:sticky;
  top:0;
  background:white;
  padding:10px;
  border-bottom:1px solid #eee;
  display:flex;
  gap:8px;
  z-index:5;

}

.buttons button{
  padding:6px 10px;
  border-radius:6px;
  border:1px solid #ccc;
  background:#f5f5f5;
  cursor:pointer;
}

/* 橙色统计按钮 */
.start-btn{
  background:#ff9800;
  border:none;
  color:white;
  font-weight:bold;
}

/* 滚动区 */
.episode-list{
  max-height:300px;
  overflow-y:auto;
  padding:8px;
}

/* 剧标题 */
.drama-header{
  font-weight:bold;
  cursor:pointer;
  padding:6px 0;
}

.toggle-icon{
  color:#3f51b5;
  margin-right:6px;
}

</style>