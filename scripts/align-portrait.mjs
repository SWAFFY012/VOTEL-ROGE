import sharp from 'sharp';
import cvReady from '@techstark/opencv-js';
const cv=await cvReady;
const w=1920,h=1080;
const load=async(path)=>{const raw=await sharp(path).resize(w,h).ensureAlpha().raw().toBuffer();const mat=cv.matFromArray(h,w,cv.CV_8UC4,raw);const gray=new cv.Mat();cv.cvtColor(mat,gray,cv.COLOR_RGBA2GRAY);return {mat,gray};};
const source=await load('public/peel/letov-new.png');
const target=await load('C:/Users/a_zlo/Downloads/video letov/frames/frame_0301.webp');
const detector=new cv.ORB(7000,1.2,8,19,0,2,0,31,10);
const k1=new cv.KeyPointVector(),k2=new cv.KeyPointVector(),d1=new cv.Mat(),d2=new cv.Mat();
const empty=new cv.Mat(),mask=cv.Mat.zeros(h,w,cv.CV_8UC1);
cv.rectangle(mask,new cv.Point(667,255),new cv.Point(1230,705),new cv.Scalar(255),-1);
detector.detectAndCompute(source.gray,empty,k1,d1);
detector.detectAndCompute(target.gray,mask,k2,d2);
const matcher=new cv.BFMatcher(cv.NORM_HAMMING,false),pairs=new cv.DMatchVectorVector();matcher.knnMatch(d1,d2,pairs,2);
const a=[],b=[];
for(let i=0;i<pairs.size();i++){const pair=pairs.get(i);if(pair.size()<2)continue;const p=pair.get(0),q=pair.get(1);if(p.distance<q.distance*.72){const s=k1.get(p.queryIdx).pt,t=k2.get(p.trainIdx).pt;a.push(s.x,s.y);b.push(t.x,t.y);}}
console.log('Matches',a.length/2);
if(a.length<8)process.exit(1);
const from=cv.matFromArray(a.length/2,1,cv.CV_32FC2,a),to=cv.matFromArray(b.length/2,1,cv.CV_32FC2,b),inliers=new cv.Mat();
const transform=cv.estimateAffine2D(from,to,inliers,cv.RANSAC,4);
console.log('Inliers',Array.from(inliers.data).filter(Boolean).length,'Matrix',Array.from(transform.data64F));

const result=new cv.Mat();cv.warpAffine(source.mat,result,transform,new cv.Size(w,h),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
await sharp(Buffer.from(result.data),{raw:{width:w,height:h,channels:4}}).webp({lossless:true}).toFile('public/peel/letov-aligned.webp');


