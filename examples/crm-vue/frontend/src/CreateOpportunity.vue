<script setup lang="ts">
import axios from 'axios';
import { message } from 'ant-design-vue';

const canCreate = hasPermission('opportunity:create');
const save = async () => {
  if (!canCreate) return;
  await axios.post('/api/opportunities', { name: 'Demo' });
  message.success('创建成功');
  router.push('/opportunities');
};
</script>

<template>
  <form>
    <input name="name" required />
    <button v-if="canCreate" @click="save">创建商机</button>
  </form>
</template>
