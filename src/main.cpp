#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>
#include <Splitter.h>
#include <FS.h>
//#include <Webserver.h>

//PINES DE SALIDA
#define led 15

//Functions definitions
bool get_mqtt_credentials();
void check_mqtt_connection();
bool reconnect();
void process_sensors();
void process_actuators();
void send_data_to_broker();
void callback(char *topic, byte *payload, unsigned int length);
void process_incoming_msg(String topic, String incoming);

//-------------------VARIABLES GLOBALES--------------------------
int contconexion = 0;

//const char *ssid = "TeleCentro-82ba";
//const char *password = "U2N2ZMLR2NQZ";

const char *ssid = "webiot";
const char *password = "webiotpswd";

const char *mqtt_server = "webiot.com.ar";
const int mqtt_port = 1893;

unsigned long previousMillis = 0;
long lastReconnectAttemp = 0;

String dId = "webiot-1234";
String webhook_pass = "ZF3TWfCbed";
String webhook_endpoint = "http://webiot.com.ar:3001/api/getdevicecredentials";

Splitter splitter;

//-------------------------------------------------------------------------
WiFiClient espClient;
PubSubClient client(espClient);
ESP8266WebServer server(80);

long varsLastSend[20];
String last_received_msg = "";
String last_received_topic = "";
int prev_temp = 0;
int prev_hum = 0;

DynamicJsonDocument mqtt_data_doc(2048);

//WiFiClient client;
//------------------------CALLBACK-----------------------------
void callback(char *topic, byte *payload, unsigned int length)
{

  String incoming = "";

  for (int i = 0; i < length; i++)
  {
    incoming += (char)payload[i];
  }

  incoming.trim();

  process_incoming_msg(String(topic), incoming);
}

//------------------------RECONNECT-----------------------------
bool reconnect()
{

  if (!get_mqtt_credentials())
  {
    Serial.println("\n\n      Error getting mqtt credentials :( \n\n RESTARTING IN 10 SECONDS");
    delay(10000);
    ESP.restart();
  }

  //Setting up Mqtt Server
  client.setServer(mqtt_server, mqtt_port);
  Serial.println("Intentando conexion MQTT...");
  // Crea un ID de cliente al azar
  String str_client_id = "device_" + dId + "_" + random(1, 9999);
  const char *username = mqtt_data_doc["username"];
  const char *password = mqtt_data_doc["password"];
  String str_topic = mqtt_data_doc["topic"];

  if (client.connect(str_client_id.c_str(), username, password))
  {
    Serial.println("conectado");
    client.subscribe((str_topic + "+/actdata").c_str());
  }
  else
  {
    Serial.print("\n\n         Mqtt Client Connection Failed :( ");
  }
  return true;
}

void check_mqtt_connection()
{

  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.print("\n\n         Ups WiFi Connection Failed :( ");
    Serial.println(" -> Restarting...");
    delay(15000);
    ESP.restart();
  }

  if (!client.connected())
  {

    long now = millis();

    if (now - lastReconnectAttemp > 5000)
    {
      lastReconnectAttemp = millis();
      if (reconnect())
      {
        lastReconnectAttemp = 0;
      }
    }
  }
  else
  {
    client.loop();
    process_sensors();
    send_data_to_broker();
    // print_stats();
  }
}

//USER FUNTIONS ⤵
void process_sensors()
{

  float temp = random(20, 40);

  float hum = random(60, 80);

  if (isnan(temp) || isnan(hum))
  {
    return;
  }
  mqtt_data_doc["variables"][0]["last"]["value"] = temp;

  //save temp?
  int dif = temp - prev_temp;
  if (dif < 0)
  {
    dif *= -1;
  }

  if (dif >= 2)
  {
    mqtt_data_doc["variables"][0]["last"]["save"] = 1;
  }
  else
  {
    mqtt_data_doc["variables"][0]["last"]["save"] = 1;
  }

  prev_temp = temp;

  mqtt_data_doc["variables"][1]["last"]["value"] = hum;

  //save hum?
  dif = hum - prev_hum;
  if (dif < 0)
  {
    dif *= -1;
  }

  if (dif >= 2)
  {
    mqtt_data_doc["variables"][1]["last"]["save"] = 1;
  }
  else
  {
    mqtt_data_doc["variables"][1]["last"]["save"] = 1;
  }

  prev_hum = hum;

  //get led status
  mqtt_data_doc["variables"][3]["last"]["value"] = (HIGH == digitalRead(led));
}

void process_actuators()
{
  if (mqtt_data_doc["variables"][2]["last"]["value"] == "true")
  {
    digitalWrite(led, HIGH);
    mqtt_data_doc["variables"][2]["last"]["value"] = "";
    varsLastSend[3] = 0;
  }
  else if (mqtt_data_doc["variables"][2]["last"]["value"] == "false")
  {
    digitalWrite(led, LOW);
    mqtt_data_doc["variables"][2]["last"]["value"] = "";
    varsLastSend[3] = 0;
  }
}

//TEMPLATE ⤵
void process_incoming_msg(String topic, String incoming)
{

  last_received_topic = topic;
  last_received_msg = incoming;

  String variable = splitter.split(topic, '/', 2);

  for (int i = 0; i < mqtt_data_doc["variables"].size(); i++)
  {

    if (mqtt_data_doc["variables"][i]["variable"] == variable)
    {

      DynamicJsonDocument doc(256);
      deserializeJson(doc, incoming);
      mqtt_data_doc["variables"][i]["last"] = doc;

      long counter = mqtt_data_doc["variables"][i]["counter"];
      counter++;
      mqtt_data_doc["variables"][i]["counter"] = counter;
    }
  }

  process_actuators();
}

String getContentType(String filename)
{
  if (server.hasArg("download"))
    return "application/octet-stream";
  else if (filename.endsWith(".htm"))
    return "text/html";
  else if (filename.endsWith(".html"))
    return "text/html";
  else if (filename.endsWith(".css"))
    return "text/css";
  else if (filename.endsWith(".js"))
    return "application/javascript";
  else if (filename.endsWith(".png"))
    return "image/png";
  else if (filename.endsWith(".gif"))
    return "image/gif";
  else if (filename.endsWith(".jpg"))
    return "image/jpeg";
  else if (filename.endsWith(".ico"))
    return "image/x-icon";
  else if (filename.endsWith(".xml"))
    return "text/xml";
  else if (filename.endsWith(".pdf"))
    return "application/x-pdf";
  else if (filename.endsWith(".zip"))
    return "application/x-zip";
  else if (filename.endsWith(".gz"))
    return "application/x-gzip";
  return "text/plain";
}

bool handleFileRead(String path)
{
  String htmlType = "text/html";
  if (path.endsWith("/"))
    path += "index.html";
  String contentType = getContentType(path);
  String pathWithGz = path + ".gz";
  if (SPIFFS.exists(pathWithGz) || SPIFFS.exists(path))
  {
    if (SPIFFS.exists(pathWithGz))
      path += ".gz";
    File file = SPIFFS.open(path, "r");
    if (htmlType != contentType)
    {
      server.sendHeader("Expires", "Mon, 1 Jan 2222 10:10:10 GMT");
    }
    size_t sent = server.streamFile(file, contentType);
    file.close();
    return true;
  }
  return false;
}

void send_data_to_broker()
{

  long now = millis();

  for (int i = 0; i < mqtt_data_doc["variables"].size(); i++)
  {

    if (mqtt_data_doc["variables"][i]["variableType"] == "output")
    {
      continue;
    }

    int freq = mqtt_data_doc["variables"][i]["variableSendFreq"];

    if (now - varsLastSend[i] > freq * 1000)
    {
      varsLastSend[i] = millis();

      String str_root_topic = mqtt_data_doc["topic"];
      String str_variable = mqtt_data_doc["variables"][i]["variable"];
      String topic = str_root_topic + str_variable + "/sdata";

      String toSend = "";

      serializeJson(mqtt_data_doc["variables"][i]["last"], toSend);

      client.publish(topic.c_str(), toSend.c_str());

      //STATS
      long counter = mqtt_data_doc["variables"][i]["counter"];
      counter++;
      mqtt_data_doc["variables"][i]["counter"] = counter;
    }
  }
}

bool get_mqtt_credentials()
{

  Serial.println("Getting MQTT Credentials from WebHook  ⤵");
  delay(1000);

  String toSend = "dId=" + dId + "&password=" + webhook_pass;

  HTTPClient http;

  http.begin(espClient, webhook_endpoint);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");

  int response_code = http.POST(toSend);

  if (response_code < 0)
  {
    Serial.print("\n\n         Error Sending Post Request :( ");
    http.end();
    return false;
  }

  if (response_code != 200)
  {
    Serial.print("\n\n         Error in response :(   e-> " + response_code);
    http.end();
    return false;
  }

  if (response_code == 200)
  {
    String responseBody = http.getString();

    Serial.println("Mqtt Credentials Obtained Successfully :) ");

    deserializeJson(mqtt_data_doc, responseBody);
    http.end();
    delay(1000);
  }

  return true;
}

//------------------------SETUP-----------------------------
void setup()
{
  // Inicia Salidas
  pinMode(led, OUTPUT);

  // Inicia Serial
  Serial.begin(9600);
  Serial.println("");
  SPIFFS.begin();

  // Conexión WIFI
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED and contconexion < 50)
  { //Cuenta hasta 50 si no se puede conectar lo cancela
    ++contconexion;
    delay(500);
    Serial.print(".");
  }
  if (contconexion < 50)
  {
    //para usar con ip fija
    IPAddress ip(192, 168, 0, 156);
    IPAddress gateway(192, 168, 0, 1);
    IPAddress subnet(255, 255, 255, 0);
    WiFi.config(ip, gateway, subnet);

    Serial.println("");
    Serial.println("WiFi conectado");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("");
    Serial.println("Error de conexion");
  }

  WiFi.mode(WIFI_STA);

  client.setCallback(callback);

  server.onNotFound([]()
                    {
                      if (!handleFileRead(server.uri()))
                        server.send(404, "text/plain", "FileNotFound");
                    });
  server.begin();
}

//--------------------------LOOP--------------------------------
void loop()
{
  check_mqtt_connection();
  server.handleClient();
}
