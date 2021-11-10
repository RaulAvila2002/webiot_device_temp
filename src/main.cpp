/*-------------------------
  - Ejemplo de Termostato IOT
  - Mide temperartura con ds18b20
  - Posee dos salidas Rele
  - Interfaz web
  - Encoder 
  - Display i2c
  - Timer - Alarma
  -------------------------*/
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>
#include <Splitter.h>
#include <FS.h>
#include <WiFiManager.h>
#include <OneWire.h>
#include <DallasTemperature.h>

//PINES DE SALIDA
#define RY1 D7
#define RY2 D8

//Functions definitions
bool get_mqtt_credentials();
void check_mqtt_connection();
bool reconnect();
void process_sensors();
void process_actuators();
void send_data_to_broker();
void callback(char *topic, byte *payload, unsigned int length);
void process_incoming_msg(String topic, String incoming);

/**********dynamic contents ***********/
const char get_toggle_digitalOut[] = {"/digital_outputs/toggle"};
const char get_status_dig_out[] = {"/digital_outputs"};
const char get_status_dig_in[] = {"/digital_inputs"};
const char get_status_analog_output[] = "/analog_outputs";
const char get_update_analog_output[] = "/analog_outputs/update";
const char get_status_analog_inputs[] = "/analog_inputs";
const char get_status_registers[] = "/registers";
const char get_config[] = "/config";
//-------------------VARIABLES GLOBALES--------------------------
int contconexion = 0;

const char *ssid = "TeleCentro-82ba";
const char *password = "U2N2ZMLR2NQZ";

const char *ApSsid = "webiot";
const char *ApPass = "webiotpswd";

const char *mqtt_server = "webiot.com.ar";
const int mqtt_port = 1893;

unsigned long previousMillis = 0;
long lastReconnectAttemp = 0;
long lastReconnectWifi = 0;

String dId = "11223344";
String webhook_pass = "hTOsfOGGSe";

String webhook_endpoint = "http://168.181.187.173:3001/api/getdevicecredentials";

Splitter splitter;

//-------------------------------------------------------------------------
WiFiClient espClient;
PubSubClient client(espClient);
ESP8266WebServer server(80);
WiFiManager wm;
OneWire ds(D6); // on pin 10 (a 4.7K resistor is necessary)
DallasTemperature sensor(&ds);

long varsLastSend[20];
String last_received_msg = "";
String last_received_topic = "";
int prev_temp = 0;
int prev_hum = 0;

DynamicJsonDocument mqtt_data_doc(2048);
// DynamicJsonDocument config_data_doc(512);

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
    delay(30000);
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
    Serial.println("Mqtt Client Connection Failed :( ");
  }
  return true;
}

//  Chequeo de conexiones

void check_mqtt_connection()
{

  //  Verifica conexión wifi

  if (WiFi.status() != WL_CONNECTED)
  {
    long wifiWait = millis();
    if (wifiWait - lastReconnectWifi > 30000)
    {
      lastReconnectWifi = millis();
      Serial.println("WiFi Connection Failed :( ");
      Serial.println(" -> Restarting...");
    }
  }

  //  Verifica conexion MQTT

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

  sensor.requestTemperatures();
  float temp = sensor.getTempCByIndex(0);

  if (isnan(temp))
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

  //get led status
  //mqtt_data_doc["variables"][3]["last"]["value"] = (HIGH == digitalRead(led));
}

void process_actuators()
{
  // if (mqtt_data_doc["variables"][2]["last"]["value"] == "true")
  // {
  //   digitalWrite(RY1, HIGH);
  //   mqtt_data_doc["variables"][2]["last"]["value"] = "";
  //   varsLastSend[3] = 0;
  // }
  // else if (mqtt_data_doc["variables"][2]["last"]["value"] == "false")
  // {
  //   digitalWrite(RY1, LOW);
  //   mqtt_data_doc["variables"][2]["last"]["value"] = "";
  //   varsLastSend[3] = 0;
  // }
}

//TEMPLATE ⤵
void process_incoming_msg(String topic, String incoming)
{

  last_received_topic = topic;
  last_received_msg = incoming;

  String variable = splitter.split(topic, '/', 2);
  Serial.println(variable);
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

char toggleOutput(String pinName)
{
  if (pinName.equals("dout1"))
  {
    digitalWrite(RY1, !digitalRead(RY1));
    return digitalRead(RY1);
  }
  else if (pinName.equals("dout2"))
  {
    digitalWrite(RY2, !digitalRead(RY2));
    return digitalRead(RY2);
  }
  else
    return 2;
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

//get_status_dig_out
void handleDigitalOutStatusJson()
{
  char someBuffer[200];
  sprintf(someBuffer, "{\"digital_outputs\":{\"dout1\":%c,\"dout2\":%c}}", !digitalRead(RY1) + 48, !digitalRead(RY2) + 48);

  server.send(200, "application/json", someBuffer);
}
//get_toggle_out
void handleDigitalOutToggle()
{
  String someBuffer = "";
  char stateOfPin = toggleOutput(server.arg(0));
  someBuffer += String(stateOfPin, DEC);
  server.send(200, "text/plain", someBuffer);
}

// handleResgistersStatus
void handleResgistersStatus()
{
  int reg1 = random(1, 999);
  int reg2 = random(1, 999);
  char someBuffer[200];
  sprintf(someBuffer, "{\"registers\":{\"reg1\":%d,\"reg2\":%d}}", reg1, reg2);
  server.send(200, "application/json", someBuffer);
}

void handleConfig()
{
  char someBuffer[200];
  sprintf(someBuffer, "{\"config\":{\"ssid\":\"%s\",\"pass\":\"%s\",\"server\":\"%s\",\"port\":%d,\"dId\":\"%s\",\"dIdPass\":\"%s\"}}", wm.getWiFiSSID().c_str(), wm.getWiFiPass().c_str(), mqtt_server, mqtt_port, dId.c_str(), webhook_pass.c_str());
  server.send(200, "application/json", someBuffer);
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

      Serial.println(topic);
      Serial.println(toSend);
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
    Serial.println(responseBody);
    http.end();
    delay(1000);
  }

  return true;
}

//------------------------SETUP-----------------------------
void setup()
{
  // Inicia Salidas

  pinMode(RY1, OUTPUT);
  pinMode(RY2, OUTPUT);

  // Inicia Serial
  Serial.begin(9600);
  Serial.println("");

  // Inicializar Sensor
  sensor.begin();

  SPIFFS.begin();

  //Conexión WIFI
  //wm.resetSettings();
  WiFi.mode(WIFI_STA);

  Serial.print("\n\n\nWiFi Connection in Progress");
  WiFi.begin(ssid, password);

  int counter = 0;

  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
    counter++;

    if (counter > 10)
    {
      Serial.print("  ⤵");
      Serial.print("\n\n         Ups WiFi Connection Failed :( ");
      Serial.println(" -> Restarting...");
      delay(2000);
      ESP.restart();
    }
  }

  Serial.print("  ⤵");

  //Printing local ip
  Serial.println("\n\n         WiFi Connection -> SUCCESS :)");
  Serial.print("\n         Local IP -> ");
  Serial.print(WiFi.localIP());
  Serial.println(" ");

  /*if (wm.autoConnect("WEBIOT-AP"))
  {
    Serial.println("connected...yeey :)");
  }
  else
  {
    Serial.println("Config Portal Running");
  }
  */
  client.setCallback(callback);

  server.on(get_status_dig_out, handleDigitalOutStatusJson);
  server.on(get_toggle_digitalOut, handleDigitalOutToggle);
  // server.on(get_status_dig_in, handleDigitalInStatusJson);
  // server.on(get_status_analog_output, handleAnalogOutStatus);
  // server.on(get_update_analog_output, handleSetAnalogOut);
  // server.on(get_status_analog_inputs, handleAnalogInStatus);
  server.on(get_status_registers, handleResgistersStatus);
  server.on(get_config, handleConfig);
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
