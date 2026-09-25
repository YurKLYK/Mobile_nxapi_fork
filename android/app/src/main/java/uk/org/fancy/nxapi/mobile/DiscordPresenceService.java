package uk.org.fancy.nxapi.mobile;

import android.app.*;
import android.content.Intent;
import android.graphics.Color;
import android.os.IBinder;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class DiscordPresenceService extends Service {
    public static final String ACTION_STOP="uk.org.fancy.nxapi.mobile.STOP_DISCORD";
    private static final String CHANNEL_ID="discord_presence";
    private static final int NOTIFICATION_ID=2774;
    private ScheduledExecutorService executor;
    private String endpoint;
    private String accessKey;
    private String lastGameName="";
    private long gameStartedAt;

    @Override public void onCreate(){
        super.onCreate();
        NotificationManager manager=getSystemService(NotificationManager.class);
        NotificationChannel channel=new NotificationChannel(CHANNEL_ID,"Discord Rich Presence",NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Nintendo Switchのプレイ状況をDiscordへ反映します");
        manager.createNotificationChannel(channel);
        startForeground(NOTIFICATION_ID,notification("Discordへ接続しています…"));
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&ACTION_STOP.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        if(intent!=null){endpoint=intent.getStringExtra("endpoint");accessKey=intent.getStringExtra("accessKey");}
        if(executor==null&&endpoint!=null&&accessKey!=null){
            MainActivity.startDiscordPresence(MainActivity.DISCORD_APPLICATION_ID);
            executor=Executors.newSingleThreadScheduledExecutor();
            executor.scheduleWithFixedDelay(this::refreshPresence,0,20,TimeUnit.SECONDS);
        }
        return START_NOT_STICKY;
    }

    private void refreshPresence(){
        HttpURLConnection connection=null;
        try{
            connection=(HttpURLConnection)new URL(endpoint+"/api/presence").openConnection();
            connection.setConnectTimeout(5000);connection.setReadTimeout(10000);
            connection.setRequestProperty("x-nxapi-key",accessKey);
            if(connection.getResponseCode()!=200)throw new Exception("HTTP "+connection.getResponseCode());
            StringBuilder body=new StringBuilder();
            try(BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream()))){String line;while((line=reader.readLine())!=null)body.append(line);}
            JSONObject root=new JSONObject(body.toString());
            JSONObject presence=root.optJSONObject("presence");
            JSONObject game=presence==null?null:presence.optJSONObject("game");
            String userName=root.optString("name","Nintendo Switchユーザー");
            String gameName=game==null?"":game.optString("name","");
            String imageUrl=game==null?"":game.optString("imageUri","");
            if(imageUrl.isEmpty())imageUrl=root.optString("imageUri","");
            String details=gameName.isEmpty()?"Nintendo Switch":gameName;
            String state="ユーザー: "+userName;
            JSONObject splatoon3=root.optJSONObject("splatoon3");
            if(splatoon3!=null){
                details=splatoon3.optString("details",details);
                String splatoonState=splatoon3.optString("state","");
                if(!splatoonState.isEmpty())state=splatoonState+"｜"+userName;
                String splatoonImage=splatoon3.optString("imageUri","");
                if(!splatoonImage.isEmpty())imageUrl=splatoonImage;
            }
            details=limit(details,128);state=limit(state,128);
            long updatedAt=presence==null?0:presence.optLong("updatedAt",0);
            if(!gameName.equals(lastGameName)){lastGameName=gameName;gameStartedAt=gameName.isEmpty()?0:(updatedAt>0?updatedAt:System.currentTimeMillis()/1000);}
            MainActivity.updateDiscordPresence(gameName,imageUrl,details,state,gameStartedAt);
            String notificationText=gameName.isEmpty()?userName+"：オンライン":userName+"："+gameName;
            String splatnetStatus=root.optString("splatnet3Status","idle");
            if("connected".equals(splatnetStatus))notificationText="SplatNet 3接続済み｜"+notificationText;
            else if("error".equals(splatnetStatus))notificationText="SplatNet 3接続失敗｜"+notificationText;
            updateNotification(notificationText);
        }catch(Throwable error){updateNotification("ゲーム情報の更新を待機中");}
        finally{if(connection!=null)connection.disconnect();}
    }

    private Notification notification(String text){
        Intent open=new Intent(this,MainActivity.class);
        PendingIntent openIntent=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop=new Intent(this,DiscordPresenceService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent=PendingIntent.getService(this,1,stop,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,CHANNEL_ID).setSmallIcon(R.drawable.ic_launcher).setColor(Color.rgb(230,0,18)).setContentTitle("nxapi Discord連携").setContentText(text).setContentIntent(openIntent).setOngoing(true).addAction(new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this,R.drawable.ic_launcher),"停止",stopIntent).build()).build();
    }

    private void updateNotification(String text){getSystemService(NotificationManager.class).notify(NOTIFICATION_ID,notification(text));}
    private static String limit(String value,int max){return value.length()<=max?value:value.substring(0,max);}
    @Override public void onDestroy(){if(executor!=null){executor.shutdownNow();executor=null;}MainActivity.stopDiscordPresence();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
