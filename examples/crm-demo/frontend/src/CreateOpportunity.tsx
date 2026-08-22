import axios from 'axios';

export function CreateOpportunity() {
  const save = () => axios.post('/api/opportunities', { name: 'Demo' });
  return <form><input name="name" required /><button onClick={save}>创建商机</button></form>;
}
