import sharp from 'sharp';
const f='brand/LOGO DESKLESS PNG...png';
const {data,info}=await sharp(f).raw().toBuffer({resolveWithObject:true});
const L=[];for(let i=0;i<info.width*info.height;i++){if(data[i*4+3]>=224)L.push([0.2126*data[i*4]+0.7152*data[i*4+1]+0.0722*data[i*4+2],i]);}
L.sort((a,b)=>a[0]-b[0]);
console.log('opaque px',L.length);
for(const q of [0,0.0005,0.005,0.02,0.1,0.25,0.5,0.75,0.9,0.98,0.995,0.9995,1]){const [l,i]=L[Math.min(L.length-1,Math.floor(q*L.length))];const x=i%info.width,y=(i-x)/info.width;console.log(q,'#'+[0,1,2].map(c=>data[i*4+c].toString(16).padStart(2,'0')).join(''),x,y);}
const bg=await sharp('brand/LOGO DESKLESS PNG.png').raw().toBuffer();console.log('bg corner',[...bg.slice(0,4)]);
