-- Databricks notebook source
-- Creates the Unity Catalog functions that app/agent.toml binds as tools. Empty in the reference.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

USE SCHEMA IDENTIFIER(:project || '_ops');
